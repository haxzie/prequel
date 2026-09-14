/**
 * Profile pictures: copied from the provider, uploaded from the dashboard,
 * served from here — and never a URL on somebody else's CDN.
 */
import {
  applyD1Migrations,
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { scheduled } from "../src/cron.ts";
import app from "../src/index.ts";
import { mirrorProviderPicture, providerPictureAt, sniffImage } from "../src/lib/avatars.ts";
import { database } from "../src/db.ts";
import { deviceToken, sha256 } from "../src/lib/ids.ts";
import { scalar } from "./helpers.ts";

/** The first bytes of each format, padded to the twelve the sniff reads. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);

const GOOGLE = "https://lh3.googleusercontent.com/a/ACg8ocK-example=s96-c";

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
    "INSERT INTO organization (id, name, slug, storage_quota_bytes) VALUES ('org1', 'Acme', 'acme', 1000000)",
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

afterEach(() => vi.unstubAllGlobals());

async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const response = await app.fetch(
    new Request(`https://api.prequel.sh${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...init.headers },
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

const imageOf = () =>
  scalar<string | null>(env.DB.prepare("SELECT image FROM user WHERE id = 'u1'"));

/** Google, answering a picture — or a status — to any fetch that reaches it. */
function stubGoogle(answer: Uint8Array | number) {
  const asked: string[] = [];
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.includes("googleusercontent.com")) return original(input as RequestInfo, init);
    asked.push(url);
    if (typeof answer === "number") return new Response("no", { status: answer });
    return new Response(answer, { headers: { "content-type": "image/jpeg" } });
  });
  return asked;
}

describe("sniffImage", () => {
  it("reads the type off the bytes", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(WEBP)).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<html>challenge</html>"))).toBeNull();
    expect(sniffImage(new Uint8Array(3))).toBeNull();
  });
});

describe("providerPictureAt", () => {
  it("asks Google for the size we keep, whatever size the profile came with", () => {
    expect(providerPictureAt(GOOGLE, 256)).toBe(
      "https://lh3.googleusercontent.com/a/ACg8ocK-example=s256-c",
    );
    expect(providerPictureAt("https://lh3.googleusercontent.com/a/x", 256)).toBe(
      "https://lh3.googleusercontent.com/a/x=s256-c",
    );
  });

  it("leaves another host's URL alone, and refuses anything not https", () => {
    expect(providerPictureAt("https://example.com/me.png", 256)).toBe("https://example.com/me.png");
    expect(providerPictureAt("http://example.com/me.png", 256)).toBeNull();
    expect(providerPictureAt("not a url", 256)).toBeNull();
  });
});

describe("mirrorProviderPicture", () => {
  it("copies the picture into R2 and points the row at our copy", async () => {
    const asked = stubGoogle(JPEG);
    await env.DB.exec(`UPDATE user SET image = '${GOOGLE}' WHERE id = 'u1'`);

    const copied = await mirrorProviderPicture(env, database(env), { id: "u1", image: GOOGLE });

    expect(copied).toBe(true);
    expect(asked).toEqual(["https://lh3.googleusercontent.com/a/ACg8ocK-example=s256-c"]);
    const image = await imageOf();
    expect(image).toMatch(new RegExp(`^${env.API_URL}/p/avatar/[1-9A-HJ-NP-Za-km-z]{16}\\.jpg$`));

    const object = await env.MEDIA.get(`avatars/${image!.split("/").pop()}`);
    expect(object?.httpMetadata?.contentType).toBe("image/jpeg");
  });

  it("leaves the provider URL in place when the copy fails, for the cron to retry", async () => {
    stubGoogle(403);
    await env.DB.exec(`UPDATE user SET image = '${GOOGLE}' WHERE id = 'u1'`);

    expect(await mirrorProviderPicture(env, database(env), { id: "u1", image: GOOGLE })).toBe(
      false,
    );
    expect(await imageOf()).toBe(GOOGLE);
  });

  it("does nothing for a picture that is already ours, or for nobody's", async () => {
    const asked = stubGoogle(JPEG);
    const ours = `${env.API_URL}/p/avatar/abcdefghjkmnpqrs.jpg`;
    expect(await mirrorProviderPicture(env, database(env), { id: "u1", image: ours })).toBe(false);
    expect(await mirrorProviderPicture(env, database(env), { id: "u1", image: null })).toBe(false);
    expect(asked).toEqual([]);
  });

  it("is what the hourly sweep does for accounts that predate it", async () => {
    stubGoogle(PNG);
    await env.DB.exec(`UPDATE user SET image = '${GOOGLE}' WHERE id = 'u1'`);

    await scheduled(env);

    expect(await imageOf()).toContain(`${env.API_URL}/p/avatar/`);
    expect(await imageOf()).toMatch(/\.png$/);
  });
});

describe("PUT /v1/me/avatar", () => {
  it("stores the picture and answers with where it is", async () => {
    const response = await call("/v1/me/avatar", { method: "PUT", body: WEBP });
    expect(response.status).toBe(200);

    const { image } = (await response.json()) as { image: string };
    expect(image).toMatch(/\.webp$/);
    expect(await imageOf()).toBe(image);

    // Served, public, and cached for good: the name changes with the picture.
    const served = await app.fetch(new Request(image), env, createExecutionContext());
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("cache-control")).toContain("immutable");
  });

  it("replaces the previous picture rather than leaving it behind", async () => {
    const first = (await (await call("/v1/me/avatar", { method: "PUT", body: JPEG })).json()) as {
      image: string;
    };
    const second = (await (await call("/v1/me/avatar", { method: "PUT", body: PNG })).json()) as {
      image: string;
    };

    expect(second.image).not.toBe(first.image);
    expect(await env.MEDIA.get(`avatars/${first.image.split("/").pop()}`)).toBeNull();
    expect(await env.MEDIA.get(`avatars/${second.image.split("/").pop()}`)).not.toBeNull();
  });

  it("goes by the bytes, not the declared type", async () => {
    const response = await call("/v1/me/avatar", {
      method: "PUT",
      body: PNG,
      headers: { "content-type": "image/jpeg" },
    });
    expect(((await response.json()) as { image: string }).image).toMatch(/\.png$/);
  });

  it("refuses something that is not an image, and something too large", async () => {
    expect(
      (await call("/v1/me/avatar", { method: "PUT", body: "<svg onload=alert(1)>" })).status,
    ).toBe(415);

    const huge = new Uint8Array(300 * 1024);
    huge.set(JPEG);
    expect((await call("/v1/me/avatar", { method: "PUT", body: huge })).status).toBe(413);
  });

  it("needs to be signed in", async () => {
    token = "not-a-token";
    expect((await call("/v1/me/avatar", { method: "PUT", body: JPEG })).status).toBe(401);
  });
});

describe("DELETE /v1/me/avatar", () => {
  it("goes back to the marble and removes the object", async () => {
    const { image } = (await (
      await call("/v1/me/avatar", { method: "PUT", body: JPEG })
    ).json()) as {
      image: string;
    };

    expect((await call("/v1/me/avatar", { method: "DELETE" })).status).toBe(200);
    expect(await imageOf()).toBeNull();
    expect(await env.MEDIA.get(`avatars/${image.split("/").pop()}`)).toBeNull();
  });
});

describe("GET /p/avatar/:file", () => {
  it("answers 404 for a name that is not one of ours", async () => {
    for (const file of [
      "../videos/x.mp4",
      "abc.jpg",
      "abcdefghjkmnpqrs.svg",
      "abcdefghjkmnpqrs.jpg",
    ]) {
      const response = await app.fetch(
        new Request(`https://api.prequel.sh/p/avatar/${file}`),
        env,
        createExecutionContext(),
      );
      expect(response.status).toBe(404);
    }
  });
});

describe("the sharer's picture on a link", () => {
  async function shared() {
    const created = (await (
      await call("/v1/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "A recording", contentType: "video/mp4", sizeBytes: 100 }),
      })
    ).json()) as { id: string };
    await env.MEDIA.put(`videos/org1/${created.id}.mp4`, new Uint8Array(100));
    await call(`/v1/videos/${created.id}/complete`, { method: "POST" });
    const slug = await scalar<string>(
      env.DB.prepare("SELECT slug FROM video WHERE id = ?").bind(created.id),
    );
    const response = await app.fetch(
      new Request(`https://api.prequel.sh/p/${slug}`),
      env,
      createExecutionContext(),
    );
    return (await response.json()) as { owner: { image: string | null } };
  }

  it("is given out once it is ours, and never while it is the provider's", async () => {
    await env.DB.exec(`UPDATE user SET image = '${GOOGLE}' WHERE id = 'u1'`);
    expect((await shared()).owner.image).toBeNull();

    const { image } = (await (
      await call("/v1/me/avatar", { method: "PUT", body: JPEG })
    ).json()) as {
      image: string;
    };
    expect((await shared()).owner.image).toBe(image);
  });
});
