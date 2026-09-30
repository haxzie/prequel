/**
 * Presigned URLs for R2's S3-compatible endpoint.
 *
 * The `MEDIA` binding is still used — for HEAD and DELETE, which need no URL —
 * but a binding cannot mint a credential for somebody *else* to use, and that is
 * what both ends of this feature need. The desktop app PUTs hundreds of
 * megabytes straight to R2 and the player GETs them straight back; neither
 * passes through this Worker, which is what keeps a Worker viable as the API at
 * all.
 */
import { AwsClient } from "aws4fetch";

import { required, type Env } from "../env.ts";

/** One hour. Long enough for a large export on a domestic uplink. */
const UPLOAD_TTL = 60 * 60;

/**
 * Six hours for playback.
 *
 * Long enough that a video left paused in a tab still resumes, short enough that
 * a URL scraped out of the page's HTML stops working the same day. The page that
 * mints it is server-rendered per request, so the visitor always gets a fresh one.
 */
const PLAYBACK_TTL = 6 * 60 * 60;

function client(env: Env): AwsClient {
  return new AwsClient({
    accessKeyId: required(env, "R2_ACCESS_KEY_ID"),
    secretAccessKey: required(env, "R2_SECRET_ACCESS_KEY"),
    // R2 ignores the region but the SigV4 signature covers it, so it has to be
    // the literal string R2 signs with. "us-east-1" produces a signature R2
    // computes differently and rejects as invalid — which reads as bad
    // credentials rather than as a wrong region.
    region: "auto",
    service: "s3",
  });
}

function objectUrl(env: Env, key: string): string {
  const account = required(env, "R2_ACCOUNT_ID");
  const bucket = required(env, "R2_BUCKET");
  // Path style, not virtual-hosted. R2's account endpoint serves every bucket
  // off one hostname; a bucket-as-subdomain URL does not resolve.
  return `https://${account}.r2.cloudflarestorage.com/${bucket}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/**
 * A URL the client may PUT one object to.
 *
 * `X-Amz-Expires` in the query rather than a header, which is what `signQuery`
 * arranges: the uploader is an `https.request` from Electron, which cannot add a
 * signature header it does not have the secret to compute.
 *
 * **`contentType` does not constrain the upload.** Query signing covers `host`
 * and nothing else — `X-Amz-SignedHeaders=host` — so a client may PUT whatever
 * type it likes and R2 records that, not this. It is passed anyway because it
 * decides the object *key*'s extension upstream, and because a signer that
 * starts covering headers later should already have the right value. What
 * actually determines the stored type is the header the client sends, which is
 * why `main/share.ts` reads it off the poster's own data URL.
 */
export async function signedUpload(env: Env, key: string, contentType: string): Promise<string> {
  const url = new URL(objectUrl(env, key));
  url.searchParams.set("X-Amz-Expires", String(UPLOAD_TTL));

  const signed = await client(env).sign(
    new Request(url, { method: "PUT", headers: { "content-type": contentType } }),
    { aws: { signQuery: true } },
  );

  return signed.url;
}

/**
 * How much of a file goes in one part.
 *
 * Eight mebibytes. The number decides what a broken connection costs: the whole
 * point of splitting an upload is that a part which dies is re-sent on its own,
 * so a smaller part is a cheaper mistake and a larger one is fewer requests.
 * Eight puts a 572 MB export in 72 parts and a retry at about ten seconds on a
 * domestic uplink, and the Class A operations that buys are pennies.
 *
 * **Every part but the last must be exactly this size.** R2 enforces it when
 * the upload is completed rather than as each part arrives, so a client that
 * sizes them differently uploads the entire file successfully and is refused at
 * the very end — which is the most expensive possible moment to find out. The
 * client is told this number rather than choosing one.
 *
 * It is also comfortably over R2's own minimum for a part that is not the last,
 * which is the other half of the same rule — see `worthSplitting`.
 */
export const PART_SIZE = 8 * 1024 * 1024;

/**
 * Whether a file of this size should go up in parts at all.
 *
 * R2 refuses a part that is not the last and is under its minimum — the error
 * is `Your proposed upload is smaller than the minimum allowed object size`,
 * and like the equal-size rule it arrives at `complete`, after every byte has
 * been sent. So a small share split into parts uploads perfectly and fails at
 * the end, which is exactly the shape of failure this whole feature exists to
 * remove.
 *
 * Anything that does not reach a second part has nothing to gain from being
 * split anyway: a file under one part is one PUT either way, and one PUT is the
 * path that has always worked.
 */
export function worthSplitting(sizeBytes: number): boolean {
  return sizeBytes > PART_SIZE;
}

/**
 * Starts a multipart upload and says what to call it.
 *
 * Through the binding rather than the S3 API, which is a choice worth naming:
 * an upload can be driven from either interface once it exists, so the parts
 * still arrive as presigned S3 PUTs from the desktop app while this Worker
 * creates and finishes it with no signing and no XML to parse. The three
 * lifecycle calls are kept together here so that moving them to the S3 API, if
 * that interoperability ever stops holding, is this file and nothing else.
 */
export async function createUpload(env: Env, key: string, contentType: string): Promise<string> {
  const upload = await env.MEDIA.createMultipartUpload(key, {
    httpMetadata: { contentType },
  });

  return upload.uploadId;
}

/**
 * A URL the client may PUT one part of an upload to.
 *
 * The part number and the upload id travel in the query, and are therefore
 * covered by the signature: a URL for part 3 cannot be turned into a URL for
 * part 4 by editing it.
 */
export async function signedUploadPart(
  env: Env,
  key: string,
  uploadId: string,
  partNumber: number,
): Promise<string> {
  const url = new URL(objectUrl(env, key));
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("X-Amz-Expires", String(UPLOAD_TTL));

  const signed = await client(env).sign(new Request(url, { method: "PUT" }), {
    aws: { signQuery: true },
  });

  return signed.url;
}

/** One part, as the client reports it having landed. */
export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/**
 * Assembles the parts into the object.
 *
 * Sorted here rather than trusted in the order they arrived: the client may
 * upload parts in any order, and R2 assembles them in the order this list gives
 * — so a list out of order produces a file whose middle is shuffled, which
 * completes successfully and plays as corruption.
 *
 * The quotes R2 puts around an ETag are stripped. A part reported as `"abc"`
 * and offered back as `"\"abc\""` is not the same string, and the upload is
 * refused for a mismatch that is pure punctuation.
 */
export async function completeUpload(
  env: Env,
  key: string,
  uploadId: string,
  parts: UploadedPart[],
): Promise<void> {
  const upload = env.MEDIA.resumeMultipartUpload(key, uploadId);

  await upload.complete(
    [...parts]
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((part) => ({ partNumber: part.partNumber, etag: part.etag.replace(/^"|"$/g, "") })),
  );
}

/**
 * Throws away an upload and the parts already in it.
 *
 * Never fatal to the caller. The parts are storage the team is paying for and
 * cannot see, so this is worth attempting on every path that gives up — but an
 * abort that itself fails must not replace the error that caused it, which is
 * the one worth reporting.
 */
export async function abortUpload(env: Env, key: string, uploadId: string): Promise<void> {
  try {
    await env.MEDIA.resumeMultipartUpload(key, uploadId).abort();
  } catch (cause) {
    console.error("r2: could not abort a multipart upload", cause);
  }
}

/** A URL anybody may GET the object from, until it expires. */
export async function signedPlayback(env: Env, key: string): Promise<string> {
  const url = new URL(objectUrl(env, key));
  url.searchParams.set("X-Amz-Expires", String(PLAYBACK_TTL));

  const signed = await client(env).sign(new Request(url, { method: "GET" }), {
    aws: { signQuery: true },
  });

  return signed.url;
}

/** Where a team's objects live. The team id keys it so a listing is scopeable. */
export function videoKey(teamId: string, videoId: string, extension: string): string {
  return `videos/${teamId}/${videoId}.${extension}`;
}

/**
 * Where a still lives.
 *
 * The extension follows the bytes rather than being assumed. The editor grabs
 * its poster with `toDataURL("image/png")`, and an object stored as `.jpg` with
 * `content-type: image/jpeg` holding PNG bytes is the kind of thing a browser
 * forgives and an Open Graph scraper does not — the share card silently loses
 * its image.
 */
export function posterKey(teamId: string, videoId: string, contentType: string): string {
  return `posters/${teamId}/${videoId}.${contentType === "image/jpeg" ? "jpg" : "png"}`;
}

/**
 * Where a recording's transcript lives.
 *
 * Beside the video rather than the poster, because it shares the video's
 * lifetime: it is deleted with the recording and never handed out on its own.
 */
export function transcriptKey(teamId: string, videoId: string): string {
  return `transcripts/${teamId}/${videoId}.json`;
}
