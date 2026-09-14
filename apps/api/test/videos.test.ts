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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("the export settings", () => {
  it("are kept with the recording", async () => {
    const response = await call("/v1/videos", {
      method: "POST",
      body: JSON.stringify({
        title: "A recording",
        contentType: "video/mp4",
        sizeBytes: 100,
        width: 1920,
        height: 1080,
        fps: 60,
        // "Full": the frame's own size, which is null rather than a number.
        shortEdge: null,
      }),
    });
    const { id } = (await response.json()) as { id: string };
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });

    const listed = (await (await call("/v1/videos")).json()) as {
      videos: { exportFps: number | null; exportShortEdge: number | null }[];
    };
    expect(listed.videos[0]?.exportFps).toBe(60);
    expect(listed.videos[0]?.exportShortEdge).toBeNull();
  });

  it("are optional, for an app that predates them", async () => {
    const { id } = (await (await create(100)).json()) as { id: string };
    const row = await env.DB.prepare("SELECT export_fps, export_short_edge FROM video WHERE id = ?")
      .bind(id)
      .first<{ export_fps: number | null; export_short_edge: number | null }>();
    expect(row).toEqual({ export_fps: null, export_short_edge: null });
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

describe("POST /v1/videos/:id/transcript", () => {
  /** A minute and a half of one word a second — long enough to divide. */
  const transcript = {
    language: "en",
    words: Array.from({ length: 90 }, (_, index) => ({
      at: index * 1000,
      end: index * 1000 + 800,
      text: `w${index}`,
    })),
  };

  /** What the model answers, or a status to fail with. */
  let openai: { chapters: { at: number; title: string }[] } | number = { chapters: [] };
  /** How many times OpenAI was asked. */
  let asked = 0;

  beforeEach(() => {
    openai = { chapters: [] };
    asked = 0;

    const original = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.includes("api.openai.com")) return original(input as RequestInfo, init);

      asked += 1;
      if (typeof openai === "number") return new Response("no", { status: openai });
      return Response.json({
        choices: [{ message: { content: JSON.stringify(openai) } }],
        usage: { prompt_tokens: 321, completion_tokens: 45 },
      });
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  /** Only OpenAI configured, so the chain is one model and then the heuristic. */
  const keyed = { ...env, OPENAI_API_KEY: "test-key" };

  /** `call`, with a key in the environment so the model is actually asked. */
  async function send(id: string, body: unknown, durationMs = 90_000) {
    const created = (await (
      await call("/v1/videos", {
        method: "POST",
        body: JSON.stringify({
          title: "A recording",
          contentType: "video/mp4",
          sizeBytes: 100,
          durationMs,
        }),
      })
    ).json()) as { id: string };

    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request(`https://api.prequel.sh/v1/videos/${id || created.id}/transcript`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      keyed,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return { id: created.id, response };
  }

  async function rowOf(id: string) {
    const row = await env.DB.prepare(
      "SELECT chapters, chapters_source, chapters_model, chapters_input_tokens, chapters_output_tokens, chapters_retry_at FROM video WHERE id = ?",
    )
      .bind(id)
      .first<{
        chapters: string | null;
        chapters_source: string | null;
        chapters_model: string | null;
        chapters_input_tokens: number | null;
        chapters_output_tokens: number | null;
        chapters_retry_at: number | null;
      }>();
    return row!;
  }

  async function chaptersOf(id: string) {
    const stored = await scalar<string | null>(
      env.DB.prepare("SELECT chapters FROM video WHERE id = ?").bind(id),
    );
    return stored ? (JSON.parse(stored) as { at: number; title: string }[]) : null;
  }

  it("stores the transcript and the chapters made from it", async () => {
    openai = {
      chapters: [
        { at: 0, title: "Getting started" },
        { at: 45, title: "The second half" },
      ],
    };

    const { id, response } = await send("", transcript);
    // 202: the transcript is stored, the chapters are still being made. The
    // desktop app does not wait on the model to finish its own upload.
    expect(response.status).toBe(202);

    const object = await env.MEDIA.get(`transcripts/org1/${id}.json`);
    expect(object).not.toBeNull();
    expect(((await object!.json()) as { words: unknown[] }).words).toHaveLength(90);

    expect(await chaptersOf(id)).toEqual([
      { at: 0, title: "Getting started" },
      // Seconds from the model, milliseconds on the row: the player reads the
      // same unit as `durationMs` and never converts.
      { at: 45_000, title: "The second half" },
    ]);

    // Who made them and what it cost, for the record.
    const row = await rowOf(id);
    expect(row.chapters_source).toBe("model");
    expect(row.chapters_model).toBe("openai/gpt-4o-mini");
    expect(row.chapters_input_tokens).toBe(321);
    expect(row.chapters_output_tokens).toBe(45);
    expect(row.chapters_retry_at).toBeNull();
  });

  it("never asks the model about a recording too short to divide", async () => {
    const { id, response } = await send("", transcript, 30_000);

    expect(response.status).toBe(202);
    expect(asked).toBe(0);
    expect(await chaptersOf(id)).toBeNull();
    expect((await rowOf(id)).chapters_source).toBe("none");
  });

  it("falls back to heuristic chapters when the model fails, and marks them for a retry", async () => {
    openai = 500;

    const { id, response } = await send("", transcript);

    // The share is not the thing that failed, and the link still has a table
    // of contents — a rougher one, made from the pauses in the transcript.
    expect(response.status).toBe(202);
    const row = await rowOf(id);
    expect(row.chapters_source).toBe("heuristic");
    expect(row.chapters_model).toBe("heuristic");
    expect(row.chapters_input_tokens).toBe(0);
    expect((await chaptersOf(id))?.length).toBeGreaterThanOrEqual(2);
    // Stamped for another go at the models, an hour on.
    expect(row.chapters_retry_at).toBeGreaterThan(Date.now() / 1000 + 3_000);
    // The transcript is kept so that retry has something to read.
    expect(await env.MEDIA.get(`transcripts/org1/${id}.json`)).not.toBeNull();
  });

  it("offers heuristic chapters to the model again when the link is opened", async () => {
    openai = 500;
    const { id } = await send("", transcript);
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });
    expect((await rowOf(id)).chapters_source).toBe("heuristic");

    // The outage is over, and the hour has passed.
    openai = {
      chapters: [
        { at: 0, title: "Getting started" },
        { at: 45, title: "The second half" },
      ],
    };
    await env.DB.prepare("UPDATE video SET chapters_retry_at = 1 WHERE id = ?").bind(id).run();

    const slug = await scalar<string>(
      env.DB.prepare("SELECT slug FROM video WHERE id = ?").bind(id),
    );
    const ctx = createExecutionContext();
    await app.fetch(new Request(`https://api.prequel.sh/p/${slug}`), keyed, ctx);
    await waitOnExecutionContext(ctx);

    const row = await rowOf(id);
    expect(row.chapters_source).toBe("model");
    expect(row.chapters_model).toBe("openai/gpt-4o-mini");
    expect(row.chapters_retry_at).toBeNull();
    expect(await chaptersOf(id)).toEqual([
      { at: 0, title: "Getting started" },
      { at: 45_000, title: "The second half" },
    ]);
  });

  it("does not retry before the hour is up, nor a row the model already wrote", async () => {
    openai = 500;
    const { id } = await send("", transcript);
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });

    const before = asked;
    const slug = await scalar<string>(
      env.DB.prepare("SELECT slug FROM video WHERE id = ?").bind(id),
    );
    const ctx = createExecutionContext();
    await app.fetch(new Request(`https://api.prequel.sh/p/${slug}`), keyed, ctx);
    await waitOnExecutionContext(ctx);

    // A view inside the hour costs nothing: an outage is not multiplied by
    // however many people open the link during it.
    expect(asked).toBe(before);
    expect((await rowOf(id)).chapters_source).toBe("heuristic");
  });

  it("clears the previous chapters when a new transcript arrives", async () => {
    openai = {
      chapters: [
        { at: 0, title: "Old start" },
        { at: 45, title: "Old middle" },
      ],
    };
    const { id } = await send("", transcript);
    expect((await rowOf(id)).chapters_model).toBe("openai/gpt-4o-mini");

    // The second transcript's chapters fall to the heuristic. What must not
    // happen is the first transcript's chapters — or its model and tokens —
    // staying on the row and describing a recording they were not made from.
    openai = 500;
    await send(id, transcript);
    const row = await rowOf(id);
    expect(row.chapters_source).toBe("heuristic");
    expect(row.chapters_model).toBe("heuristic");
    expect(await chaptersOf(id)).not.toEqual([
      { at: 0, title: "Old start" },
      { at: 45_000, title: "Old middle" },
    ]);
  });

  it("refuses a transcript that is not one", async () => {
    const { response } = await send("", { words: "hello" });
    expect(response.status).toBe(400);
    expect(asked).toBe(0);
  });

  it("refuses a recording belonging to another team", async () => {
    const { id } = await send("", transcript);

    await env.DB.exec(
      "INSERT INTO organization (id, name, slug) VALUES ('org2', 'Other', 'other')",
    );
    await env.DB.exec("UPDATE video SET team_id = 'org2'");

    expect((await send(id, transcript)).response.status).toBe(404);
  });

  it("hands the chapters to the owner and to the share link alike", async () => {
    openai = {
      chapters: [
        { at: 0, title: "Getting started" },
        { at: 45, title: "The second half" },
      ],
    };
    const { id } = await send("", transcript);
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });

    const playback = (await (await call(`/v1/videos/${id}/playback`)).json()) as {
      chapters: unknown;
    };
    expect(playback.chapters).toEqual([
      { at: 0, title: "Getting started" },
      { at: 45_000, title: "The second half" },
    ]);

    const slug = await scalar<string>(
      env.DB.prepare("SELECT slug FROM video WHERE id = ?").bind(id),
    );
    const ctx = createExecutionContext();
    const shared = (await (
      await app.fetch(new Request(`https://api.prequel.sh/p/${slug}`), env, ctx)
    ).json()) as { chapters: unknown };
    await waitOnExecutionContext(ctx);

    expect(shared.chapters).toEqual(playback.chapters);
  });

  it("serves the transcript as subtitles, and says so on both playback answers", async () => {
    // As Whisper names it; stored as the tag a `<track>` wants.
    const { id } = await send("", { ...transcript, language: "french" }, 30_000);
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });

    const playback = (await (await call(`/v1/videos/${id}/playback`)).json()) as {
      slug: string;
      captions: { language: string } | null;
    };
    expect(playback.captions).toEqual({ language: "fr" });

    const ctx = createExecutionContext();
    const shared = (await (
      await app.fetch(new Request(`https://api.prequel.sh/p/${playback.slug}`), env, ctx)
    ).json()) as { captions: unknown };
    await waitOnExecutionContext(ctx);
    expect(shared.captions).toEqual({ language: "fr" });

    const track = await app.fetch(
      new Request(`https://api.prequel.sh/p/${playback.slug}/captions.vtt`),
      env,
      createExecutionContext(),
    );
    expect(track.status).toBe(200);
    expect(track.headers.get("content-type")).toContain("text/vtt");
    const body = await track.text();
    expect(body.startsWith("WEBVTT")).toBe(true);
    expect(body).toContain("w0 w1");
  });

  it("has no subtitles for a recording that was never transcribed", async () => {
    const { id } = (await (await create(100)).json()) as { id: string };
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });

    const playback = (await (await call(`/v1/videos/${id}/playback`)).json()) as {
      slug: string;
      captions: unknown;
    };
    expect(playback.captions).toBeNull();

    const track = await app.fetch(
      new Request(`https://api.prequel.sh/p/${playback.slug}/captions.vtt`),
      env,
      createExecutionContext(),
    );
    expect(track.status).toBe(404);
  });

  it("names the sharer on the link without giving their email away", async () => {
    const { id } = (await (await create(100)).json()) as { id: string };
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });

    const slug = await scalar<string>(
      env.DB.prepare("SELECT slug FROM video WHERE id = ?").bind(id),
    );
    const ctx = createExecutionContext();
    const response = await app.fetch(new Request(`https://api.prequel.sh/p/${slug}`), env, ctx);
    const text = await response.text();
    await waitOnExecutionContext(ctx);

    const shared = JSON.parse(text) as { owner: { name: string; seed: string } | null };
    expect(shared.owner?.name).toBe("Ana");
    // Stable, so the marble is the same on every view; opaque, so it is not
    // the id or the address.
    expect(shared.owner?.seed).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(text).not.toContain("ana@example.com");
    expect(text).not.toContain('"u1"');
  });

  it("answers an empty list, not null, for a recording with none", async () => {
    const { id } = await send("", transcript, 30_000);
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });

    const playback = (await (await call(`/v1/videos/${id}/playback`)).json()) as {
      chapters: unknown;
    };
    expect(playback.chapters).toEqual([]);
  });

  it("goes with the recording when it is deleted", async () => {
    const { id } = await send("", transcript);
    await env.MEDIA.put(`videos/org1/${id}.mp4`, new Uint8Array(100));
    await call(`/v1/videos/${id}/complete`, { method: "POST" });

    await call(`/v1/videos/${id}`, { method: "DELETE" });

    // Storage is the thing being paid for, and a transcript is somebody's
    // words. Neither has any business outliving the recording.
    expect(await env.MEDIA.get(`transcripts/org1/${id}.json`)).toBeNull();
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
