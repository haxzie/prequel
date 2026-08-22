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
