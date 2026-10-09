/**
 * Resolves a public X post to the video files X itself serves.
 *
 * The route this takes is the embed widget's: `cdn.syndication.twimg.com`,
 * which is what every "embedded post" on the web reads and so needs no key, no
 * account and no cookie. The documented v2 API is not an option — the media
 * fields it would answer with are not on the free tier at all, and the guest
 * token flow that replaced it for scrapers stopped serving post detail in 2023.
 *
 * Nothing here downloads a video. It returns the `video.twimg.com` URLs, which
 * the browser then fetches itself; `video.twimg.com` answers
 * `access-control-allow-origin: *`, which is what makes that possible and what
 * keeps the bytes off this Worker. Proxying them would be a Worker serving
 * someone else's video at our egress — the thing Cloudflare's terms single out —
 * to no benefit the page can see.
 *
 * CORS is only half of what the browser needs. That host also refuses a request
 * carrying a `Referer` of anywhere but X, so the fetch has to suppress it; the
 * note on `referrerPolicy` in `Downloader.tsx` has the detail.
 */

const SYNDICATION = "https://cdn.syndication.twimg.com/tweet-result";

/**
 * Long enough for a slow round trip, short enough that the route cannot hang.
 * The upstream is a CDN read and normally answers in well under a second.
 */
const TIMEOUT_MS = 10_000;

/**
 * A browser's user agent, because the endpoint answers a bare `fetch` with the
 * HTML error shell rather than JSON. It is the embed widget's backend and
 * expects to be called by a page.
 */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

export type VideoVariant = {
  url: string;
  /** `1080p`, or `GIF` for a looping post. What the button says. */
  label: string;
  width: number;
  height: number;
  /** Bits per second, as X reports it. Zero for a GIF, which has no ladder. */
  bitrate: number;
};

export type PostMedia = {
  /** A GIF on X is a silent MP4, so it differs only in what we call it. */
  kind: "video" | "gif";
  durationMs: number;
  /** The frame X shows before playback. Served from `pbs.twimg.com`. */
  poster: string;
  variants: VideoVariant[];
};

export type ResolvedPost = {
  id: string;
  author: { name: string; handle: string };
  text: string;
  media: PostMedia[];
};

/** Why a resolve did not produce a video, in the words the page shows. */
export type ResolveFailure =
  { reason: "bad-url" } | { reason: "not-found" } | { reason: "no-video" } | { reason: "upstream" };

export type ResolveResult = { ok: true; post: ResolvedPost } | ({ ok: false } & ResolveFailure);

/**
 * Pulls the post id out of whatever was pasted.
 *
 * Accepts the four hosts X has used, because links of every vintage are still
 * in circulation and a 2019 `twitter.com` URL points at the same post. The
 * numeric id on its own is accepted too — it is what someone retyping from a
 * URL ends up with.
 *
 * Anything else returns null rather than being coerced. A hostname check is the
 * one thing standing between this and being a general-purpose fetcher for any
 * URL a caller fancies, pointed at our Worker's egress.
 */
export function postIdFrom(input: string): string | null {
  const trimmed = input.trim();

  if (/^\d{1,20}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    // A pasted link routinely arrives without a scheme. Prepending one is what
    // the paste box would otherwise make the person do by hand.
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (!["x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com"].includes(host)) return null;

  // `/<handle>/status/<id>`, and `/i/web/status/<id>` for the form X's own
  // share sheet produces. `/statuses/` is the older spelling of the same path.
  const match = url.pathname.match(/\/stat(?:us|uses)\/(\d{1,20})/);
  return match?.[1] ?? null;
}

/**
 * The `token` query parameter the endpoint requires.
 *
 * Derived from the id rather than issued, so there is nothing to obtain and
 * nothing to keep fresh. The float conversion loses precision on a 19-digit id —
 * `Number` cannot hold one — which looks like a bug and is not: the upstream
 * computes it the same lossy way, so the value matches. It is a cache-busting
 * checksum, not a credential.
 */
function tokenFor(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

/**
 * The pixel size of one variant, read off its URL.
 *
 * X puts the resolution in the path — `/vid/avc1/1280x720/…` — and reports it
 * nowhere in the JSON, which carries only the post's aspect ratio. Reading the
 * path is therefore the only way to label a variant `720p` rather than by its
 * bitrate, which means nothing to anybody choosing one.
 */
function sizeFrom(url: string): { width: number; height: number } | null {
  const match = url.match(/\/(\d{2,5})x(\d{2,5})\//);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

export async function resolvePost(input: string): Promise<ResolveResult> {
  const id = postIdFrom(input);
  if (!id) return { ok: false, reason: "bad-url" };

  const url = `${SYNDICATION}?${new URLSearchParams({ id, token: tokenFor(id), lang: "en" })}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error("x-video: syndication unreachable", error);
    return { ok: false, reason: "upstream" };
  }

  // A post that is deleted, protected or from a suspended account answers 404
  // with an HTML shell rather than JSON. They are one case to the page: there is
  // no video here and no amount of retrying changes that.
  if (response.status === 404) return { ok: false, reason: "not-found" };

  if (!response.ok) {
    console.error(`x-video: syndication answered ${response.status}`);
    return { ok: false, reason: "upstream" };
  }

  const payload = (await response.json().catch(() => null)) as SyndicationPost | null;
  if (!payload) return { ok: false, reason: "upstream" };

  // An age-restricted or withheld post answers 200 with a tombstone in place of
  // the post. It has no media and never will, so it is `not-found` too.
  if (payload.__typename === "TweetTombstone") return { ok: false, reason: "not-found" };

  const media = (payload.mediaDetails ?? [])
    .filter((item) => item.type === "video" || item.type === "animated_gif")
    .flatMap<PostMedia>((item) => {
      const gif = item.type === "animated_gif";

      const variants = (item.video_info?.variants ?? [])
        // The HLS playlist goes, and with it the only entry that is not a file:
        // an `.m3u8` is a list of segments, so saving it saves a text file that
        // names videos. Every `video/mp4` entry is one complete file.
        .filter((variant) => variant.content_type === "video/mp4")
        .flatMap<VideoVariant>((variant) => {
          const size = sizeFrom(variant.url);
          if (!size) return [];

          return [
            {
              url: variant.url,
              label: gif ? "GIF" : `${Math.min(size.width, size.height)}p`,
              width: size.width,
              height: size.height,
              bitrate: variant.bitrate ?? 0,
            },
          ];
        })
        // Best first, so the page's default choice is the top of the list and
        // the person picking a smaller one is doing it deliberately.
        .sort((a, b) => b.bitrate - a.bitrate || b.width - a.width);

      if (variants.length === 0) return [];

      return [
        {
          kind: gif ? "gif" : "video",
          durationMs: item.video_info?.duration_millis ?? 0,
          poster: item.media_url_https ?? "",
          variants,
        },
      ];
    });

  if (media.length === 0) return { ok: false, reason: "no-video" };

  return {
    ok: true,
    post: {
      id: payload.id_str ?? id,
      author: {
        name: payload.user?.name ?? "",
        handle: payload.user?.screen_name ?? "",
      },
      text: payload.text ?? "",
      media,
    },
  };
}

/**
 * Only the fields that are read, and every one optional.
 *
 * The endpoint is undocumented, so this is a description of a response rather
 * than a contract anybody owes us. Treating each field as absent is what makes
 * a shape change degrade to "no video found" instead of throwing.
 */
interface SyndicationPost {
  __typename?: string;
  id_str?: string;
  text?: string;
  user?: { name?: string; screen_name?: string };
  mediaDetails?: {
    type?: string;
    media_url_https?: string;
    video_info?: {
      duration_millis?: number;
      variants?: { content_type?: string; bitrate?: number; url: string }[];
    };
  }[];
}
