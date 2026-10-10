/**
 * The update feed.
 *
 * The redirect route is the one that matters, and it is asserted without a
 * network at all — which is the point of deriving the version from the filename
 * rather than asking anything where the release is. The property under test is
 * that a versioned asset resolves to *its own* build: an updater is routinely
 * asked to fetch files belonging to the version it is replacing, and a feed
 * that only ever answers "latest" 404s on every one of them.
 *
 * Every URL here is on the mirror. GitHub cannot serve these: the repository is
 * private, and a release asset answers 404 to a request with no token — which
 * is every request the updater makes. That is the bug these expectations pin.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import app from "../src/index.ts";

async function call(path: string): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(new Request(`https://api.prequel.sh${path}`), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

afterEach(() => vi.unstubAllGlobals());

describe("the channel feed", () => {
  it("sends the channel file to the one object on the mirror that moves", async () => {
    const response = await call("/v1/updates/darwin-arm64/latest-mac.yml");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://assets.prequel.sh/desktop/latest-mac.yml",
    );
  });

  it("survives the cache-busting query the updater appends", async () => {
    const response = await call("/v1/updates/darwin-arm64/latest-mac.yml?noCache=k3f9a1");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://assets.prequel.sh/desktop/latest-mac.yml",
    );
  });

  it("sends a versioned asset to its own build, not to the latest one", async () => {
    const response = await call("/v1/updates/darwin-arm64/Prequel-0.0.2-arm64-mac.zip");

    expect(response.headers.get("location")).toBe(
      "https://assets.prequel.sh/desktop/0.0.2/Prequel-0.0.2-arm64-mac.zip",
    );
  });

  it("resolves the disk image the channel file also lists", async () => {
    const response = await call("/v1/updates/darwin-arm64/Prequel-1.2.30-arm64.dmg");

    expect(response.headers.get("location")).toBe(
      "https://assets.prequel.sh/desktop/1.2.30/Prequel-1.2.30-arm64.dmg",
    );
  });

  it("refuses a filename that would redirect somewhere else", async () => {
    // The failure this guards is an open redirect *on the API's own origin* —
    // a link anyone has reason to trust, pointing wherever the path said.
    for (const file of ["..%2F..%2Fevil", "https:%2F%2Fevil.example%2Fx", "a%20b.zip"]) {
      expect((await call(`/v1/updates/darwin-arm64/${file}`)).status).toBe(404);
    }
  });
});

describe("release notes", () => {
  it("answers with the notes the mirror holds for the version it was asked about", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe("https://assets.prequel.sh/desktop/0.0.3/notes.json");
        return Response.json({
          version: "0.0.3",
          notes: "- Ten layout arrangements",
          publishedAt: "2026-08-24T00:00:00Z",
        });
      }),
    );

    const response = await call("/v1/updates/notes?version=0.0.3");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      notes: "- Ten layout arrangements",
      publishedAt: "2026-08-24T00:00:00Z",
    });
  });

  it("answers 200 with nothing when the mirror cannot be reached", async () => {
    // A missing changelog is a modal without a changelog. It must not reach the
    // app as a failed update check, which is what any error status would mean.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );

    const response = await call("/v1/updates/notes?version=0.0.3");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notes: null, publishedAt: null });
  });

  it("answers 200 with nothing for a version the mirror has no notes for", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Not Found", { status: 404 })),
    );

    expect(await (await call("/v1/updates/notes?version=9.9.9")).json()).toEqual({
      notes: null,
      publishedAt: null,
    });
  });

  it("will not hand an arbitrary string to the mirror", async () => {
    expect((await call("/v1/updates/notes?version=../../etc")).status).toBe(400);
    expect((await call("/v1/updates/notes")).status).toBe(400);
  });
});
