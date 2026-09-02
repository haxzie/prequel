/**
 * What `complete` is actually for.
 *
 * `POST /v1/videos` checks the quota against a size the *client* declared,
 * because at that point the bytes have not been sent and there is nothing else
 * to check. That makes the HEAD in `complete` load-bearing rather than
 * decorative: without it a client that declares one megabyte and uploads four
 * gigabytes walks straight past the quota, and the library shows a plausible
 * number for ever afterwards.
 */
import {
  applyD1Migrations,
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import app from "../src/index.ts";
import { scalar } from "./helpers.ts";
import { deviceToken, sha256 } from "../src/lib/ids.ts";

let token = "";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const table of ["device_token", "video", "member", "organization", "user"]) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }

  await env.DB.exec("INSERT INTO user (id, name, email) VALUES ('u1', 'Ana', 'ana@example.com')");
  await env.DB.exec(
    "INSERT INTO organization (id, name, slug, storage_quota_bytes) VALUES ('org1', 'Acme', 'acme', 1000)",
  );
  await env.DB.exec(
    "INSERT INTO member (id, organization_id, user_id, role) VALUES ('m1', 'org1', 'u1', 'owner')",
  );

  token = deviceToken();
  await env.DB.prepare(
    "INSERT INTO device_token (id, token_hash, user_id, label) VALUES ('d1', ?, 'u1', 'Ana-Mac')",
  )
    .bind(await sha256(token))
    .run();
});

async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`https://api.prequel.sh${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

function create(sizeBytes: number, posterContentType?: "image/png" | "image/jpeg") {
  return call("/v1/videos", {
    method: "POST",
    body: JSON.stringify({
      title: "A recording",
      contentType: "video/mp4",
      sizeBytes,
      durationMs: 5000,
      width: 1920,
      height: 1080,
      ...(posterContentType ? { posterContentType } : {}),
    }),
  });
}

describe("POST /v1/videos", () => {
  it("returns somewhere to put the bytes", async () => {
    const response = await create(500);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { id: string; uploadUrl: string };
    expect(body.id).toMatch(/^vid_/);
    // Presigned, so the upload never passes through the Worker — which it could
    // not, since a Worker's request body limit is far below an export's size.
    expect(body.uploadUrl).toContain("X-Amz-Signature");
  });

  it("refuses an upload that would not fit", async () => {
    const response = await create(2000);
    // 507, not 403: the request is allowed and well-formed, there is simply
    // nowhere to put it, and the app tells the two apart.
    expect(response.status).toBe(507);
  });

  it("never refuses a team whose storage is unlimited", async () => {
    // The word on the pricing page, checked against the thing that enforces it.
    // Pro's quota is a sentinel rather than a large cap precisely so this can
    // never come back 507 — a team sold "unlimited" and then told they are out
    // of storage is worse off than one that was never promised it.
    await env.DB.prepare(
      "UPDATE organization SET plan = 'pro', storage_quota_bytes = ? WHERE id = 'org1'",
    )
      .bind(Number.MAX_SAFE_INTEGER)
      .run();

    // A petabyte, which is past anything a real export reaches and past every
    // round number a cap would plausibly have been set to.
    expect((await create(1_000_000_000_000_000)).status).toBe(200);
  });

  it("does not count an abandoned upload against the quota", async () => {
    await create(900);

    // The first row is still `uploading` — no object was ever sent. Counting it
    // would let one interrupted share lock a team out of its own storage.
    expect((await create(900)).status).toBe(200);
  });
});

describe("the poster", () => {
  it("is stored as the type the client actually has", async () => {
    const response = await call("/v1/videos", {
      method: "POST",
      body: JSON.stringify({
        title: "A recording",
        contentType: "video/mp4",
        sizeBytes: 100,
        // What `Preview.tsx` grabs. Signing this as JPEG would store PNG bytes
        // under a `.jpg` key claiming `image/jpeg`, which a browser forgives and
        // an Open Graph scraper does not — the share card loses its picture and
        // nothing errors anywhere.
        posterContentType: "image/png",
      }),
    });

    const body = (await response.json()) as { id: string; posterUploadUrl: string };

    // The key is what carries the type into storage. Note the signature does
    // *not* cover `content-type` — `X-Amz-SignedHeaders=host` — so what R2
    // finally records is whatever header the client's PUT sends. That is why
    // `main/share.ts` sends the decoded type rather than trusting this URL.
    expect(body.posterUploadUrl).toContain(`${body.id}.png`);
    expect(body.posterUploadUrl).not.toContain(".jpg");
  });

  it("is skipped when the export had no still", async () => {
    const response = await call("/v1/videos", {
      method: "POST",
      body: JSON.stringify({
        title: "A recording",
        contentType: "video/mp4",
        sizeBytes: 100,
      }),
    });

    expect(((await response.json()) as { posterUploadUrl: null }).posterUploadUrl).toBeNull();
  });
});

describe("POST /v1/videos/:id/complete", () => {
  it("stores the size R2 reports, not the one the client declared", async () => {
    const { id } = (await (await create(100)).json()) as { id: string };

    // Four times what was declared. This is the case the HEAD exists for.
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(400));

    const response = await call(`/v1/videos/${id}/complete`, { method: "POST" });
    expect(response.status).toBe(200);

    const size = await scalar<number>(
      env.DB.prepare("SELECT size_bytes FROM video WHERE id = ?").bind(id),
    );

    expect(size).toBe(400);
  });

  it("marks a video failed when nothing arrived", async () => {
    const { id } = (await (await create(100)).json()) as { id: string };

    const response = await call(`/v1/videos/${id}/complete`, { method: "POST" });
    expect(response.status).toBe(400);

    const status = await scalar<string>(
      env.DB.prepare("SELECT status FROM video WHERE id = ?").bind(id),
    );

    expect(status).toBe("failed");
  });

  it("answers with a link built off the site's origin", async () => {
    const { id } = (await (await create(100)).json()) as { id: string };
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));

    const body = (await (await call(`/v1/videos/${id}/complete`, { method: "POST" })).json()) as {
      url: string;
    };

    // The share link points at the site, never at the API. This is the string
    // that ends up in somebody's chat window.
    expect(body.url).toBe(`${env.APP_URL}/v/${body.url.split("/v/")[1]}`);
    expect(body.url).toContain("/v/");
  });
});

describe("GET /v1/videos/:id/playback", () => {
  /** A row the owning team can actually watch. */
  async function ready() {
    const { id } = (await (await create(100)).json()) as { id: string };
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });
    return id;
  }

  it("hands back a signed URL the browser can play", async () => {
    const id = await ready();

    const response = await call(`/v1/videos/${id}/playback`);
    expect(response.status).toBe(200);

    const body = (await response.json()) as { src: string; contentType: string };
    // Presigned, so the bytes go straight from R2 to the player and never pass
    // through the Worker — the same arrangement the share page uses.
    expect(body.src).toContain("X-Amz-Signature");
    expect(body.contentType).toBe("video/mp4");
  });

  /**
   * The reason this route exists at all.
   *
   * The obvious implementation of a player in the dashboard is to point it at
   * `/p/:slug`, which already mints a URL — and which counts a view. Every owner
   * opening their own recording would then inflate the number printed on the
   * same page, and a team checking a link before sending it would put the count
   * into double figures before a stranger ever opened it.
   */
  it("does not count the owner as a view", async () => {
    const id = await ready();

    await call(`/v1/videos/${id}/playback`);
    await call(`/v1/videos/${id}/playback`);

    const views = await scalar<number>(
      env.DB.prepare("SELECT view_count FROM video WHERE id = ?").bind(id),
    );

    expect(views).toBe(0);
  });

  it("refuses a recording belonging to another team", async () => {
    const id = await ready();

    // Moved to a team the caller is not in. `team_id` is a foreign key, so the
    // other team has to exist for the row to be moved to it.
    await env.DB.exec(
      "INSERT INTO organization (id, name, slug) VALUES ('org2', 'Other', 'other')",
    );
    await env.DB.exec("UPDATE video SET team_id = 'org2'");

    // 404 rather than 403: confirming the id exists is the only thing this
    // endpoint could tell somebody guessing them.
    expect((await call(`/v1/videos/${id}/playback`)).status).toBe(404);
  });

  it("has nothing to play for an upload that never finished", async () => {
    // Still `uploading` — no object was ever sent, and a signature over a key
    // with nothing behind it is a player that spins.
    const { id } = (await (await create(100)).json()) as { id: string };

    expect((await call(`/v1/videos/${id}/playback`)).status).toBe(404);
  });
});

describe("GET /p/:slug/poster", () => {
  /**
   * The share card outlives the page view that produced it.
   *
   * `og:image` is scraped once and kept — by Slack, by iMessage, by anything
   * that unfurls a link. A presigned URL there works when it is tested and shows
   * a broken picture days later, with nothing failing at the time to warn you.
   * So this URL carries no signature, and that is the property under test.
   */
  it("is a plain URL with no signature in it", async () => {
    const { id } = (await (await create(100, "image/png")).json()) as { id: string };
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await env.MEDIA.put(`posters/org1/${id}.png`, new Uint8Array([1, 2, 3]));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });

    const slug = await scalar<string>(
      env.DB.prepare("SELECT slug FROM video WHERE id = ?").bind(id),
    );

    const listed = (await (await call("/v1/videos")).json()) as {
      videos: { poster: string }[];
    };

    expect(listed.videos[0]?.poster).toBe(`${env.API_URL}/p/${slug}/poster`);
    expect(listed.videos[0]?.poster).not.toContain("X-Amz-Signature");
  });

  it("serves the image to somebody with no credentials", async () => {
    const { id } = (await (await create(100, "image/png")).json()) as { id: string };
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await env.MEDIA.put(`posters/org1/${id}.png`, new Uint8Array([1, 2, 3, 4]));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });

    const slug = await scalar<string>(
      env.DB.prepare("SELECT slug FROM video WHERE id = ?").bind(id),
    );

    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request(`https://api.prequel.sh/p/${slug}/poster`),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age");
    expect((await response.arrayBuffer()).byteLength).toBe(4);
  });

  it("stops serving once the recording is deleted", async () => {
    const { id } = (await (await create(100, "image/png")).json()) as { id: string };
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await env.MEDIA.put(`posters/org1/${id}.png`, new Uint8Array([1, 2, 3]));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });

    const slug = await scalar<string>(
      env.DB.prepare("SELECT slug FROM video WHERE id = ?").bind(id),
    );

    await call(`/v1/videos/${id}`, { method: "DELETE" });

    // Deleting has to take the picture down as well as the video. A poster that
    // outlived its recording would be a frame of something somebody withdrew.
    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request(`https://api.prequel.sh/p/${slug}/poster`),
      env,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
  });
});

describe("GET /p/:slug", () => {
  it("is readable with no credentials at all", async () => {
    const { id } = (await (await create(100)).json()) as { id: string };
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });

    const slug = await scalar<string>(
      env.DB.prepare("SELECT slug FROM video WHERE id = ?").bind(id),
    );

    const ctx = createExecutionContext();
    const response = await app.fetch(new Request(`https://api.prequel.sh/p/${slug}`), env, ctx);
    await waitOnExecutionContext(ctx);

    // The whole point of a share link: the person opening it has no account and
    // is not going to make one.
    expect(response.status).toBe(200);
    const body = (await response.json()) as { src: string; teamName: string };
    expect(body.teamName).toBe("Acme");
    // The video still is signed — it is far too large to proxy through here.
    expect(body.src).toContain("X-Amz-Signature");
  });

  it("says a deleted recording was deleted rather than 404ing", async () => {
    const { id } = (await (await create(100)).json()) as { id: string };
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });
    await call(`/v1/videos/${id}`, { method: "DELETE" });

    const slug = await scalar<string>(
      env.DB.prepare("SELECT slug FROM video WHERE id = ?").bind(id),
    );

    const ctx = createExecutionContext();
    const response = await app.fetch(new Request(`https://api.prequel.sh/p/${slug}`), env, ctx);
    await waitOnExecutionContext(ctx);

    // 410, so the page can say what happened. A 404 reads as the link never
    // having worked, which is a different and more alarming thing.
    expect(response.status).toBe(410);
  });

  it("frees the storage a deleted recording was using", async () => {
    const { id } = (await (await create(900)).json()) as { id: string };
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(900));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });

    expect((await create(900)).status).toBe(507);

    await call(`/v1/videos/${id}`, { method: "DELETE" });

    // The objects go immediately, so the quota has to follow — otherwise a team
    // pays for storage R2 is no longer holding.
    expect((await create(900)).status).toBe(200);
    expect(await env.MEDIA.head(`videos/org1/${id}.mp4`)).toBeNull();
  });
});
