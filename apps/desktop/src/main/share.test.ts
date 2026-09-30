/**
 * An upload that meets a broken connection, one that is refused, and one part
 * of a file rather than all of it.
 *
 * These look identical from the dialog — both are "that didn't upload" — and
 * they must not be treated the same. A connection that broke for a moment costs
 * the whole file if it is not offered again, and an export is hundreds of
 * megabytes; a refusal repeated is a second wasted upload of the same size that
 * was never going to be accepted.
 *
 * Driven against a real `node:http` server rather than a mocked socket, because
 * the failure being reproduced is one a mock cannot have: the connection dying
 * mid-body, after the request line went out and before any response came back.
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getVersion: () => "0.0.32" } }));
vi.mock("./analytics.js", () => ({ track: () => undefined }));
vi.mock("./auth.js", () => ({ authToken: () => "a-token" }));
vi.mock("./broadcast.js", () => ({ toEveryWindow: () => undefined }));
vi.mock("./log.js", () => ({ log: () => undefined }));

const { upload } = await import("./share.js");

const BODY = "the exported bytes, standing in for half a gigabyte";

let server: Server | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

/** A file to upload, and the URL of a server behaving as `handle` says. */
async function serving(handle: (attempt: number) => "kill" | "refuse" | "accept") {
  const path = join(mkdtempSync(join(tmpdir(), "prequel-share-")), "export.mp4");
  writeFileSync(path, BODY);

  let attempts = 0;
  /** What the last accepted request actually carried. */
  let received = "";

  server = createServer((request, response) => {
    attempts += 1;
    const outcome = handle(attempts);

    if (outcome === "kill") {
      // Destroyed mid-body, which is what a connection dropping looks like from
      // the other end — not a status, not a close, just gone.
      request.socket.destroy();
      return;
    }

    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (outcome === "refuse") {
        response.writeHead(403);
        response.end();
        return;
      }

      received = Buffer.concat(chunks).toString();
      // Quoted, as R2 and every other S3 implementation returns it.
      response.writeHead(200, { etag: '"an-etag"' });
      response.end();
    });
  });

  await new Promise<void>((ready) => server!.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/key`,
    path,
    size: BODY.length,
    attempts: () => attempts,
    received: () => received,
  };
}

describe("upload", () => {
  it("offers the bytes again when the connection breaks", async () => {
    // The failure this exists for: one corrupted record three seconds into a
    // 572 MB upload threw the whole thing away and left somebody to start it
    // by hand. The second attempt is the difference.
    const { url, path, size, attempts } = await serving((n) => (n === 1 ? "kill" : "accept"));

    await expect(
      upload(url, path, 0, size, "video/mp4", new AbortController().signal, () => undefined),
    ).resolves.toBe('"an-etag"');

    expect(attempts()).toBe(2);
  });

  it("does not repeat an upload that was refused", async () => {
    // A 403 on an expired signature says the same thing the second time, and
    // saying it again costs another whole file's worth of uplink.
    const { url, path, size, attempts } = await serving(() => "refuse");

    await expect(
      upload(url, path, 0, size, "video/mp4", new AbortController().signal, () => undefined),
    ).rejects.toMatchObject({ code: "UPLOAD_403" });

    expect(attempts()).toBe(1);
  });

  it("gives up rather than trying for ever", async () => {
    // A connection that is broken every time is not a blip, and an upload that
    // retried on a loop would sit there spending somebody's uplink in silence.
    // Four, matching `UPLOAD_ATTEMPTS` — enough that a network dropping on most
    // parts still gets through, bounded so a dead one does not spin.
    const { url, path, size, attempts } = await serving(() => "kill");

    await expect(
      upload(url, path, 0, size, "video/mp4", new AbortController().signal, () => undefined),
    ).rejects.toThrow();

    expect(attempts()).toBe(4);
  });

  it("stops when the share is cancelled while it waits to try again", async () => {
    // The pause between attempts is the one moment the upload is not listening
    // for an abort. Starting the next attempt on a signal already aborted would
    // send the whole file with nothing left able to stop it.
    const abort = new AbortController();
    const { url, path, size, attempts } = await serving(() => "kill");

    const running = upload(url, path, 0, size, "video/mp4", abort.signal, () => undefined);
    // Once the first attempt has died, inside the pause before the second.
    setTimeout(() => abort.abort(), 100);

    await expect(running).rejects.toThrow();
    expect(attempts()).toBe(1);
  });

  it("reports nothing sent before starting over", async () => {
    // The bar has to fall back to zero: the next attempt begins at the first
    // byte, and progress left where it stopped claims bytes the server does
    // not have.
    const { url, path, size } = await serving((n) => (n === 1 ? "kill" : "accept"));
    const reported: number[] = [];

    await upload(url, path, 0, size, "video/mp4", new AbortController().signal, (sent: number) =>
      reported.push(sent),
    );

    expect(reported).toContain(0);
  });

  it("hands back the ETag, quotes and all", async () => {
    // The one thing a part is good for afterwards. Without it there is nothing
    // to assemble the object from, and the quotes are part of the value
    // everywhere S3 speaks of it — stripping them here and not there, or there
    // and not here, is a mismatch of pure punctuation that refuses the upload
    // after every byte has already been sent.
    const { url, path, size } = await serving(() => "accept");

    await expect(
      upload(url, path, 0, size, "video/mp4", new AbortController().signal, () => undefined),
    ).resolves.toBe('"an-etag"');
  });

  it("sends only the range it was asked for", async () => {
    // A part is a stretch of the file, and the stream's `end` is inclusive.
    // One byte out sends a body shorter than the `content-length` that was
    // promised, which hangs the request rather than failing it — and a part
    // that is the wrong bytes assembles into a video that plays as corruption.
    const { url, path, received } = await serving(() => "accept");

    await upload(
      url,
      path,
      4,
      6,
      "application/octet-stream",
      new AbortController().signal,
      () => undefined,
    );

    expect(received()).toBe(BODY.slice(4, 10));
  });

  it("sends the whole file when asked for all of it", async () => {
    const { url, path, size, received } = await serving(() => "accept");

    await upload(url, path, 0, size, "video/mp4", new AbortController().signal, () => undefined);

    expect(received()).toBe(BODY);
  });
});
