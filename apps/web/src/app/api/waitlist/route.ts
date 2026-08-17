import { z } from "zod";

import { env } from "@prequel/env";

const Signup = z.object({ email: z.email().max(254) });

/** Long enough for a slow round trip, short enough that the route cannot hang. */
const TIMEOUT_MS = 10_000;

/**
 * Accepts a waitlist signup and files it as a response to the Google Form.
 *
 * Server-side rather than posting from the browser: Google Forms sends no CORS
 * headers, so a `fetch` from the page can only be a `no-cors` request whose
 * response is opaque — the form would appear to work whether or not anything
 * arrived. Going through here means a real status is available to act on.
 *
 * What it cannot detect is a wrong field name. Google accepts the POST,
 * discards fields it does not recognise and answers 200 regardless, so a typo
 * in `WAITLIST_FIELD` loses every address with nothing logged anywhere. That is
 * the one failure mode worth re-checking against a live response after any
 * change to the form.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null);
  const parsed = Signup.safeParse(body);

  if (!parsed.success) {
    return Response.json({ message: "That doesn't look like an email address." }, { status: 400 });
  }

  try {
    const response = await fetch(env.WAITLIST_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      // Forms only accepts form encoding. A JSON body is accepted and ignored,
      // which is the silent-success case again.
      body: new URLSearchParams({ [env.WAITLIST_FIELD]: parsed.data.email }),
      // A successful submission answers 302 to the confirmation page. Following
      // it costs a second request and tells us nothing we do not already know.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // 200 is the rendered confirmation, 3xx the redirect to it. Anything else
    // means the form rejected the request or is not there any more.
    const filed = response.status === 200 || (response.status >= 300 && response.status < 400);

    if (!filed) {
      console.error(`waitlist: form answered ${response.status}`);
      return Response.json(
        { message: "We couldn't add you just now. Try again in a moment." },
        { status: 502 },
      );
    }
  } catch (error) {
    console.error("waitlist: form unreachable", error);
    return Response.json(
      { message: "We couldn't add you just now. Try again in a moment." },
      { status: 502 },
    );
  }

  return Response.json({ ok: true });
}
