/**
 * Uploading a finished export, and handing back a link.
 *
 * The bytes go straight from this Mac to R2 on a presigned URL. They do not pass
 * through the API — a Worker's request body limit is 100 MB and a two-minute 4K
 * export is well past it — so what the API does is authorise the upload, then
 * confirm afterwards that what arrived is what was declared.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { basename, extname } from "node:path";

import { webContents } from "electron";

import { IPC_CHANNELS, type ShareProgress, type ShareRequest } from "../shared/contract.js";
import { apiFetch, ApiError } from "./api.js";
import { authToken } from "./auth.js";
import { track } from "./analytics.js";
import { log } from "./log.js";

interface Created {
  id: string;
  uploadUrl: string;
  posterUploadUrl: string | null;
}

/**
 * The upload under way, if any.
 *
 * One at a time, mirroring how `export.ts` refuses a second concurrent export.
 * Two uploads racing would fight for the uplink and make both progress bars
 * meaningless.
 */
let current: { path: string; abort: AbortController } | null = null;

export function isSharing(): boolean {
  return current !== null;
}

export async function startShare(share: ShareRequest): Promise<void> {
  if (current) throw new ApiError("ALREADY_SHARING", "Something is already uploading.");

  const token = authToken();
  if (!token) throw new ApiError("SIGNED_OUT", "Sign in to share a recording.");

  const abort = new AbortController();
  current = { path: share.path, abort };

  try {
    broadcast({ path: share.path, stage: "preparing", bytesSent: 0, bytesTotal: 0 });

    track("share_started");

    const { size } = await stat(share.path);
    const contentType = extname(share.path).toLowerCase() === ".gif" ? "image/gif" : "video/mp4";
    const poster = decodePoster(share.poster);

    const created = await apiFetch<Created>("/v1/videos", {
      method: "POST",
      token,
      signal: abort.signal,
      body: JSON.stringify({
        title: share.title || basename(share.path, extname(share.path)),
        contentType,
        sizeBytes: size,
        durationMs: Math.round(share.durationMs),
        width: share.width,
        height: share.height,
        posterContentType: poster?.contentType,
      }),
    });

    // The poster first, and its failure is not fatal. A library entry with no
    // thumbnail is worth having; a share that failed because a 40 KB still
    // did not upload is not.
    if (poster && created.posterUploadUrl) {
      try {
        await put(created.posterUploadUrl, poster.bytes, poster.contentType, abort.signal);
      } catch (cause) {
        console.warn("[share] the poster did not upload:", cause);
      }
    }

    broadcast({ path: share.path, stage: "uploading", bytesSent: 0, bytesTotal: size });

    await putFile(created.uploadUrl, share.path, size, contentType, abort.signal, (sent) => {
      broadcast({ path: share.path, stage: "uploading", bytesSent: sent, bytesTotal: size });
    });

    broadcast({ path: share.path, stage: "finalising", bytesSent: size, bytesTotal: size });

    const done = await apiFetch<{ url: string }>(`/v1/videos/${created.id}/complete`, {
      method: "POST",
      token,
      signal: abort.signal,
    });

    log("info", `shared ${basename(share.path)}`);

    // Sizes, not names. The app reports the share it believes it made; the
    // Worker reports `video_shared` when the object has actually arrived, which
    // is the one to count when the two disagree.
    track("share_completed", { size_bytes: size, duration_ms: Math.round(share.durationMs) });

    broadcast({
      path: share.path,
      stage: "done",
      bytesSent: size,
      bytesTotal: size,
      url: done.url,
    });
  } catch (cause) {
    const cancelled = abort.signal.aborted;

    if (!cancelled) console.error("[share] upload failed:", cause);

    track(cancelled ? "share_cancelled" : "share_failed", {
      // The code, not the message. `ApiError` codes are ours and finite —
      // QUOTA_EXCEEDED, SIGNED_OUT, UPLOAD_403 — where a message can carry a
      // presigned URL or a path in it.
      code: cause instanceof ApiError ? cause.code : null,
    });

    broadcast({
      path: share.path,
      stage: cancelled ? "cancelled" : "failed",
      bytesSent: 0,
      bytesTotal: 0,
      error: cancelled
        ? null
        : {
            code: cause instanceof ApiError ? cause.code : null,
            message: cause instanceof Error ? cause.message : "That recording didn't upload.",
          },
    });
  } finally {
    current = null;
  }
}

export function cancelShare(): void {
  current?.abort.abort();
}

/**
 * A still, as bytes, with the type it actually is.
 *
 * The dialog already has one — `Editor.tsx` grabs a frame off the WebGL preview
 * before opening — so the library gets a thumbnail with no server-side ffmpeg
 * and no second decode of the export. It arrives as a `data:` URL because that
 * is what a canvas produces and what an `<img>` in the dialog is already showing.
 *
 * The type is read out of the URL rather than assumed. `Preview.tsx` grabs PNG
 * today; calling it JPEG anyway would store bytes that disagree with their own
 * `content-type`, which a browser forgives and an Open Graph scraper does not —
 * the share card silently loses its picture, and nothing anywhere errors.
 */
function decodePoster(poster: string | null): { bytes: Buffer; contentType: string } | null {
  if (!poster) return null;

  const match = poster.match(/^data:(image\/(?:png|jpeg));base64,(.*)$/s);
  if (!match?.[1] || !match[2]) return null;

  try {
    return { bytes: Buffer.from(match[2], "base64"), contentType: match[1] };
  } catch {
    return null;
  }
}

function put(url: string, body: Buffer, contentType: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = requestFor(url, contentType, body.byteLength, resolve, reject);
    signal.addEventListener("abort", () => req.destroy(new Error("cancelled")), { once: true });
    req.end(body);
  });
}

/**
 * Streams a file to a presigned URL, reporting bytes as they go.
 *
 * `node:https` rather than `fetch`, and the reason is the progress callback:
 * `fetch` gives no way to observe an upload in flight, and an export can be
 * hundreds of megabytes. A button with no progress for two minutes reads as a
 * hang, which is the only thing this function does that `fetch` could not.
 *
 * The length is sent explicitly. A presigned PUT is signed over the headers, and
 * chunked transfer encoding — which is what Node uses without a `content-length`
 * — makes S3 reject the signature as invalid.
 */
function putFile(
  url: string,
  path: string,
  size: number,
  contentType: string,
  signal: AbortSignal,
  onProgress: (bytesSent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = requestFor(url, contentType, size, resolve, reject);

    const stream = createReadStream(path);
    let sent = 0;
    let reported = 0;

    stream.on("data", (chunk: string | Buffer) => {
      sent += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;

      // Throttled to whole percent. The dialog writes this straight to the DOM,
      // and a 64 KB read on a fast uplink fires thousands of times a second.
      const percent = Math.floor((sent / size) * 100);
      if (percent > reported) {
        reported = percent;
        onProgress(sent);
      }
    });

    stream.on("error", reject);

    signal.addEventListener(
      "abort",
      () => {
        stream.destroy();
        req.destroy(new Error("cancelled"));
      },
      { once: true },
    );

    stream.pipe(req);
  });
}

function requestFor(
  url: string,
  contentType: string,
  length: number,
  resolve: () => void,
  reject: (error: Error) => void,
) {
  const target = new URL(url);
  // `wrangler dev` and a local R2 stand-in are plain HTTP; production is not.
  const send = target.protocol === "http:" ? httpRequest : httpsRequest;

  const req = send(
    target,
    {
      method: "PUT",
      headers: { "content-type": contentType, "content-length": length },
    },
    (response) => {
      const status = response.statusCode ?? 0;

      // Drained even when it is being ignored. An unread response body keeps the
      // socket open, and enough of those exhaust the agent's pool — which shows
      // up as the *next* upload hanging rather than this one failing.
      response.resume();

      if (status >= 200 && status < 300) resolve();
      else reject(new ApiError(`UPLOAD_${status}`, `The upload was refused (${status}).`));
    },
  );

  req.on("error", reject);
  return req;
}

/**
 * Pushes progress to every live renderer.
 *
 * Broadcast rather than sent to one window, matching how export and
 * transcription progress already travel: the editor that started it is not
 * necessarily the only one open on that recording.
 */
function broadcast(update: Omit<ShareProgress, "url" | "error"> & Partial<ShareProgress>): void {
  const message: ShareProgress = { url: null, error: null, ...update };

  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed()) contents.send(IPC_CHANNELS.shareProgress, message);
  }
}
