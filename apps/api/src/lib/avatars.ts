/**
 * Profile pictures, as objects of our own.
 *
 * Better Auth writes the provider's picture URL into `user.image` at sign-up,
 * and the dashboard has never drawn it: a URL on somebody else's CDN is a
 * request to a third party on every page that lists a person, and one that
 * goes stale without anything here noticing. So the picture is copied into R2
 * — at sign-up for a Google account, on upload from the dashboard for anyone —
 * and `user.image` is rewritten to the URL this API serves it from. A picture
 * is drawn only when its URL is ours; a provider URL still on a row is one the
 * copy has not reached yet, and the marble is drawn instead.
 *
 * `user.image` rather than a column of our own, because the table is Better
 * Auth's and every column added there has to be repeated in the plugin's
 * `additionalFields` or it is dropped on write. The field already exists for
 * exactly this, and a URL is what it holds either way.
 *
 * The key is a random token, not the user id, and a new upload is a new token:
 * the URL is public and cached as immutable, so replacing the picture *has* to
 * change the URL or every viewer keeps the old one for a year.
 */
import { eq } from "drizzle-orm";

import { schema } from "@prequel/db";

import type { Database } from "../db.ts";
import type { Env } from "../env.ts";
import { slug } from "./ids.ts";

/**
 * The most an upload may be. The dashboard sends a 256×256 WebP, which is
 * ten to twenty kilobytes; this is a ceiling against a client that did not
 * crop, not a target.
 */
export const AVATAR_MAX_BYTES = 256 * 1024;

/** The edge Google is asked for, and what the dashboard crops to. */
export const AVATAR_EDGE = 256;

export type AvatarType = "image/png" | "image/jpeg" | "image/webp";

const EXTENSIONS: Record<AvatarType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Where a picture lives; the token is what the public URL names. */
export function avatarKey(file: string): string {
  return `avatars/${file}`;
}

export function avatarUrl(env: Env, file: string): string {
  return `${env.API_URL}/p/avatar/${file}`;
}

/** Whether a `user.image` is one this API serves, as opposed to a provider's. */
export function isOurAvatar(env: Env, image: string | null | undefined): image is string {
  return typeof image === "string" && image.startsWith(`${env.API_URL}/p/avatar/`);
}

/** The file part of one of our URLs, or null for anything else. */
export function avatarFileOf(env: Env, image: string | null | undefined): string | null {
  if (!isOurAvatar(env, image)) return null;
  const file = image.slice(`${env.API_URL}/p/avatar/`.length);
  return /^[1-9A-HJ-NP-Za-km-z]{16}\.(png|jpg|webp)$/.test(file) ? file : null;
}

/**
 * What the bytes actually are, from their first few.
 *
 * The declared `content-type` is whatever the client said; a PNG uploaded as
 * `image/jpeg` would be served with the wrong type and drawn by some browsers
 * and not others. The magic numbers are what the bytes say about themselves.
 */
export function sniffImage(bytes: Uint8Array): AvatarType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Stores a picture and points the user at it.
 *
 * The previous object goes once the row points elsewhere — never before, so a
 * failed write leaves the old picture in place rather than a URL to nothing.
 */
export async function storeAvatar(
  env: Env,
  db: Database,
  userId: string,
  bytes: Uint8Array,
  type: AvatarType,
): Promise<string> {
  const file = `${slug()}.${EXTENSIONS[type]}`;

  await env.MEDIA.put(avatarKey(file), bytes, {
    httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" },
  });

  const [previous] = await db
    .select({ image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  const url = avatarUrl(env, file);
  await db
    .update(schema.user)
    .set({ image: url, updatedAt: new Date() })
    .where(eq(schema.user.id, userId));

  const old = avatarFileOf(env, previous?.image);
  if (old && old !== file) await env.MEDIA.delete(avatarKey(old));

  return url;
}

/** Back to the marble. The object goes with the URL. */
export async function removeAvatar(env: Env, db: Database, userId: string): Promise<void> {
  const [row] = await db
    .select({ image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);

  await db
    .update(schema.user)
    .set({ image: null, updatedAt: new Date() })
    .where(eq(schema.user.id, userId));

  const old = avatarFileOf(env, row?.image);
  if (old) await env.MEDIA.delete(avatarKey(old));
}

/**
 * A provider's picture URL, asked for at the size we keep.
 *
 * Google's `lh3.googleusercontent.com` URLs take a size suffix — `=s96-c` is
 * what the profile arrives with — and honour a different one, so the resize
 * happens on Google's side and no image library is needed in a Worker. Any
 * other host is fetched as it is and kept only if it is small enough.
 */
export function providerPictureAt(url: string, edge: number): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.hostname.endsWith("googleusercontent.com")) {
    return url.replace(/=s\d+(-c)?$/, "") + `=s${edge}-c`;
  }
  return url;
}

/** How long to wait on a provider before leaving the URL as it was. */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Copies a user's provider picture into R2, if they have one and it is not
 * already ours. True when the row now points at our copy.
 *
 * Nothing thrown: this runs from the sign-up hook and from the cron, and both
 * would rather leave the provider URL in place — the marble is drawn for it —
 * than turn a sign-up into an error.
 */
export async function mirrorProviderPicture(
  env: Env,
  db: Database,
  user: { id: string; image?: string | null | undefined },
): Promise<boolean> {
  if (!user.image || isOurAvatar(env, user.image)) return false;

  const source = providerPictureAt(user.image, AVATAR_EDGE);
  if (!source) return false;

  try {
    const response = await fetch(source, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // Asked for an image by name, so a host that negotiates formats answers
      // with one of the three the sniff below knows rather than, say, AVIF.
      headers: { accept: "image/webp,image/jpeg,image/png" },
    });
    if (!response.ok) {
      console.warn(`avatar: ${new URL(source).hostname} answered ${response.status}`, user.id);
      return false;
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > AVATAR_MAX_BYTES) {
      console.warn(`avatar: provider picture too large (${bytes.byteLength} bytes)`, user.id);
      return false;
    }

    const type = sniffImage(bytes);
    if (!type) {
      console.warn("avatar: provider answered something that is not an image", user.id);
      return false;
    }

    await storeAvatar(env, db, user.id, bytes, type);
    return true;
  } catch (error) {
    console.warn("avatar: could not copy the provider picture", user.id, error);
    return false;
  }
}
