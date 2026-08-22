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

function create(sizeBytes: number) {
  return call("/v1/videos", {
    method: "POST",
    body: JSON.stringify({
      title: "A recording",
      contentType: "video/mp4",
      sizeBytes,
      durationMs: 5000,
      width: 1920,
      height: 1080,
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
