import type { NextRequest } from "next/server";
import { after, userAgent } from "next/server";

import { installScript } from "@/lib/install-script";
import { capture, identify } from "@/lib/posthog-server";

/**
 * `prequel.sh/install.sh` → the script that installs Prequel and its CLI.
 *
 *     curl -fsSL https://prequel.sh/install.sh | sh
 *
 * A route rather than a file in `public/` for the same reason `/download` is
 * one: this URL is pasted into threads and into agent instructions and must
 * never change, while what it does has to follow the app. It is also the only
 * way to count installs that arrive this way — a static file in `public/` is
 * served by the CDN and tells us nothing.
 *
 * The script is in `lib/install-script.ts`, where it can be checked by a test.
 */

/**
 * How long a CDN may hold the script.
 *
 * Five minutes. Nothing in here carries a version — the download URL resolves
 * itself — so a stale copy still installs the current app, and the only cost of
 * caching is how long a fix to the script takes to reach everybody.
 */
const REVALIDATE = 300;

export async function GET(request: NextRequest): Promise<Response> {
  if (!userAgent(request).isBot) {
    after(() =>
      capture("install_script_fetched", {
        distinctId: identify(request),
        properties: {
          // Whether this was read by a person or piped into a shell. `curl` and
          // `wget` are the installs; a browser is somebody checking what the
          // script does first, which is a different and healthier number.
          agent: request.headers.get("user-agent") ?? "unknown",
          referrer: request.headers.get("referer") ?? "$direct",
        },
      }),
    );
  }

  return new Response(installScript(), {
    headers: {
      // `text/plain`, so a browser shows it rather than offering to download it:
      // anybody who is about to pipe this into a shell should be able to read it
      // first in one click.
      "content-type": "text/plain; charset=utf-8",
      "cache-control": `public, max-age=0, s-maxage=${String(REVALIDATE)}, stale-while-revalidate=60`,
    },
  });
}
