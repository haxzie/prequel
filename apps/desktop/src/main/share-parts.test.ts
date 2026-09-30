/**
 * A share going up in parts, from pressing the button to the link coming back.
 *
 * `share.test.ts` covers one range of bytes in isolation. This covers the thing
 * built out of them, which is where the mistakes that matter live: an offset
 * computed per part, a last part that is the remainder, ETags collected in the
 * order the API needs them back, and URLs fetched a batch at a time. Every one
 * of those produces a file that uploads perfectly and is wrong — or is refused
 * at `complete`, after every byte has already been sent.
 *
 * Only the JSON API is stood in for. The bytes go to a real `node:http` server
 * over a real socket, so what is asserted is what actually arrived.
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getVersion: () => "0.0.32" } }));
vi.mock("./analytics.js", () => ({ track: () => undefined }));
vi.mock("./auth.js", () => ({ authToken: () => "a-token" }));
vi.mock("./log.js", () => ({ log: () => undefined }));

/** Every progress update the renderer would have been sent. */
const broadcasts: {
  stage: string;
  bytesSent: number;
  bytesTotal: number;
  error?: { code: string | null; message: string } | null;
}[] = [];
vi.mock("./broadcast.js", () => ({
  toEveryWindow: (_channel: string, message: unknown) => {
    broadcasts.push(message as (typeof broadcasts)[number]);
  },
}));

const apiFetch = vi.fn();
vi.mock("./api.js", async () => {
  const actual = await vi.importActual<typeof import("./api.js")>("./api.js");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetch(...args) };
});

const { startShare } = await import("./share.js");

/** Long enough to be several parts, short enough to read in a failure message. */
const BODY = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMN";

let server: Server | null = null;
let base = "";
/** What each part number arrived as, keyed by part. */
let arrived = new Map<number, string>();
/** The `content-length` each part promised, which is what the signature covers. */
let promised = new Map<number, number>();
/** How each part PUT should behave, by part number and attempt. */
let behaviour: (partNumber: number, attempt: number) => "kill" | "accept" = () => "accept";
let attempts = new Map<number, number>();

beforeEach(async () => {
  broadcasts.length = 0;
  arrived = new Map();
  promised = new Map();
  attempts = new Map();
  behaviour = () => "accept";

  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const partNumber = Number(url.searchParams.get("partNumber") ?? "0");
    const attempt = (attempts.get(partNumber) ?? 0) + 1;
    attempts.set(partNumber, attempt);

    if (behaviour(partNumber, attempt) === "kill") {
      request.socket.destroy();
      return;
    }

    promised.set(partNumber, Number(request.headers["content-length"] ?? -1));

    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      arrived.set(partNumber, Buffer.concat(chunks).toString());
      response.writeHead(200, { etag: `"etag-${partNumber}"` });
      response.end();
    });
  });

  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  server?.close();
  server = null;
  vi.resetAllMocks();
});

/** A file of `BODY`, and the request the dialog would hand over. */
function sharing() {
  const path = join(mkdtempSync(join(tmpdir(), "prequel-parts-")), "export.mp4");
  writeFileSync(path, BODY);

  return {
    path,
    poster: null,
    title: "A recording",
    durationMs: 1000,
    width: 1920,
    height: 1080,
    fps: 60,
    shortEdge: null,
    transcript: null,
  };
}

/** The API, answering as the Worker would for an upload split into parts. */
function apiSplittingAt(partSize: number, onComplete?: (body: unknown) => void) {
  apiFetch.mockImplementation((path: string, init: { method?: string; body?: string }) => {
    if (path === "/v1/videos") {
      return Promise.resolve({
        id: "vid_1",
        uploadUrl: null,
        posterUploadUrl: null,
        uploadId: "up_1",
        partSize,
      });
    }

    if (path.endsWith("/upload/parts")) {
      const { from, to } = JSON.parse(init.body ?? "{}") as { from: number; to: number };
      return Promise.resolve({
        parts: Array.from({ length: to - from + 1 }, (_, index) => ({
          partNumber: from + index,
          url: `${base}/key?partNumber=${from + index}&uploadId=up_1`,
        })),
      });
    }

    if (path.endsWith("/complete")) {
      onComplete?.(JSON.parse(init.body ?? "{}"));
      return Promise.resolve({ url: "https://prequel.sh/v/abc" });
    }

    return Promise.resolve({ ok: true });
  });
}

describe("a share sent in parts", () => {
  it("puts the whole file up, in order, in one piece per part", async () => {
    // Sixteen bytes a part over fifty: three full parts and a remainder of two.
    apiSplittingAt(16);

    await startShare(sharing());

    expect([...arrived.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    // Reassembled the way R2 will reassemble it. Any offset computed wrongly
    // shows up here as a file that is the right length and the wrong bytes.
    const rebuilt = [1, 2, 3, 4].map((part) => arrived.get(part)).join("");
    expect(rebuilt).toBe(BODY);
  });

  it("makes the last part the remainder rather than a full one", async () => {
    // Asserted on the `content-length`, not only on what arrived. A last part
    // sized like the others reads past the end of the file, so the bytes that
    // turn up are the remainder either way — what differs is that the request
    // promised more than it sent. Checking the body alone passes on both, which
    // is how this test first went in useless.
    //
    // Sized wrongly it stalls rather than failing, so a regression here shows
    // up as this test timing out. That is a poor signal and an unmistakable
    // one; the alternative was no signal at all.
    apiSplittingAt(16);

    await startShare(sharing());

    expect(promised.get(1)).toBe(16);
    expect(promised.get(4)).toBe(BODY.length - 48);
    expect(arrived.get(4)).toHaveLength(BODY.length - 48);
  });

  it("hands complete every part with the ETag the store gave it", async () => {
    let completed: unknown = null;
    apiSplittingAt(16, (body) => (completed = body));

    await startShare(sharing());

    expect(completed).toEqual({
      parts: [
        { partNumber: 1, etag: '"etag-1"' },
        { partNumber: 2, etag: '"etag-2"' },
        { partNumber: 3, etag: '"etag-3"' },
        { partNumber: 4, etag: '"etag-4"' },
      ],
    });
  });

  it("re-sends only the part that broke", async () => {
    // The whole point of splitting the upload up. A network that drops during
    // part three costs part three, not the recording.
    apiSplittingAt(16);
    behaviour = (partNumber, attempt) => (partNumber === 3 && attempt === 1 ? "kill" : "accept");

    await startShare(sharing());

    expect(attempts.get(1)).toBe(1);
    expect(attempts.get(3)).toBe(2);
    expect([1, 2, 3, 4].map((part) => arrived.get(part)).join("")).toBe(BODY);
  });

  it("asks for part URLs a batch at a time", async () => {
    // A signature lasts an hour. Minting every URL at the start means the end
    // of a long upload is reached with URLs that expired on the way.
    apiSplittingAt(4);

    await startShare(sharing());

    const ranges = apiFetch.mock.calls
      .filter(([path]) => String(path).endsWith("/upload/parts"))
      .map(([, init]) => JSON.parse((init as { body: string }).body) as unknown);

    expect(ranges).toEqual([
      { from: 1, to: 10 },
      { from: 11, to: 13 },
    ]);
  });

  it("rewinds the bar by one part when one is retried, and no further", async () => {
    // A part that broke really did not land, so the bar falling back is honest
    // — what matters is how far. Each part reports against what the finished
    // ones add up to, so a retry costs its own part and nothing else. Reporting
    // against its own start instead would send the bar to zero mid-upload.
    const PART = 16;
    apiSplittingAt(PART);
    behaviour = (partNumber, attempt) => (partNumber === 3 && attempt === 1 ? "kill" : "accept");

    await startShare(sharing());

    const sent = broadcasts.filter((one) => one.stage === "uploading").map((one) => one.bytesSent);
    expect(sent.length).toBeGreaterThan(0);

    let highest = 0;
    let worstDrop = 0;
    for (const bytes of sent) {
      worstDrop = Math.max(worstDrop, highest - bytes);
      highest = Math.max(highest, bytes);
    }

    expect(worstDrop).toBeGreaterThan(0);
    expect(worstDrop).toBeLessThanOrEqual(PART);
    expect(sent.at(-1)).toBe(BODY.length);
  });

  it("throws the parts away when the upload cannot be finished", async () => {
    // Parts of an abandoned upload sit in the bucket, invisible to everybody
    // and billed to the team, until something names the upload they belong to.
    apiSplittingAt(16);
    behaviour = (partNumber) => (partNumber === 2 ? "kill" : "accept");

    await startShare(sharing());

    const aborted = apiFetch.mock.calls.find(
      ([path, init]) =>
        String(path) === "/v1/videos/vid_1/upload" &&
        (init as { method?: string } | undefined)?.method === "DELETE",
    );
    expect(aborted).toBeDefined();
    // And the dialog is told, rather than the share sitting there for ever.
    expect(broadcasts.at(-1)?.stage).toBe("failed");
  });

  it("still uploads in one go when the API offers no parts", async () => {
    // An older Worker, or a file too small to be worth splitting. The path that
    // has always existed has to keep working, because the app and the API are
    // deployed separately.
    apiFetch.mockImplementation((path: string) => {
      if (path === "/v1/videos") {
        return Promise.resolve({
          id: "vid_1",
          uploadUrl: `${base}/key`,
          posterUploadUrl: null,
          uploadId: null,
          partSize: null,
        });
      }
      if (path.endsWith("/complete")) return Promise.resolve({ url: "https://prequel.sh/v/abc" });
      return Promise.resolve({ ok: true });
    });

    await startShare(sharing());

    // No part number in the query, so the server filed it under zero.
    expect(arrived.get(0)).toBe(BODY);
    expect(broadcasts.at(-1)?.stage).toBe("done");
  });

  it("sends the bytes that are on disk", async () => {
    // Belt and braces on the reassembly above: what arrived is byte-for-byte
    // what the export actually is.
    apiSplittingAt(16);
    const share = sharing();

    await startShare(share);

    const rebuilt = [1, 2, 3, 4].map((part) => arrived.get(part)).join("");
    expect(rebuilt).toBe(readFileSync(share.path, "utf8"));
  });

  it("tells the person what happened, not what the socket said", async () => {
    // The whole reason this exists: a failed share showed somebody
    // `SSLV3_ALERT_BAD_RECORD_MAC ... alert number 20`. It names the record
    // layer of a protocol and asks them to do nothing about it.
    apiSplittingAt(16);
    behaviour = () => "kill";

    await startShare(sharing());

    const failure = broadcasts.at(-1);
    expect(failure?.stage).toBe("failed");
    expect(failure?.error?.message).toBe(
      "The upload was interrupted. Check your connection and try again.",
    );
    // The detail is still reported, where it is useful.
    expect(failure?.error?.code).toBeTruthy();
  });

  it("says so plainly when the export is no longer on disk", async () => {
    // "Try again" is the wrong advice here — the file is not coming back, and
    // repeating the share walks somebody round a loop that cannot end.
    apiSplittingAt(16);

    await startShare({ ...sharing(), path: "/tmp/prequel-not-a-real-export.mp4" });

    const failure = broadcasts.at(-1);
    expect(failure?.stage).toBe("failed");
    expect(failure?.error?.message).toBe(
      "That export isn't where it was. It may have been moved or deleted.",
    );
  });
});
