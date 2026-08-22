/**
 * Where the API is, and how to call it.
 *
 * One place for the base URL because there are now three callers — transcription,
 * sign-in and sharing — and a second copy of the fallback chain is how one of
 * them ends up pointed at production while the others talk to a dev Worker.
 *
 * Every remote call in the app is made from here, in main. That is not a
 * convention: the renderer's CSP is `connect-src 'self' prequel-media:`, so a
 * window physically cannot reach the network.
 */
import { env } from "@prequel/env";

/**
 * The API's origin.
 *
 * `apps/api` is a Cloudflare Worker on its own subdomain rather than a route on
 * the marketing site — D1 and R2 need bindings, and an upload cannot be squeezed
 * through a serverless function's request body limit.
 *
 * A packaged build gets this baked in at bundle time; see `publicEnv` in
 * `electron.vite.config.ts`. Without that it would read the schema default and
 * quietly call production from a dev machine, or localhost from a .dmg.
 */
export function apiUrl(): string {
  return process.env["PREQUEL_API_URL"] ?? env.NEXT_PUBLIC_API_URL;
}

/** The site, for anything a browser has to open. */
export function appUrl(): string {
  return process.env["PREQUEL_APP_URL"] ?? env.NEXT_PUBLIC_APP_URL;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * A JSON call to the API.
 *
 * Errors arrive as `ApiError` with the server's own message where there is one.
 * The Worker answers `{ message }` on every failure path, but a proxy or a
 * captive portal can still return HTML — so the body is parsed defensively and a
 * parse failure becomes the status rather than a `SyntaxError` from somewhere
 * unrelated.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...rest } = init;

  const response = await fetch(new URL(path, apiUrl()), {
    ...rest,
    headers: {
      ...(rest.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
  }).catch(() => {
    throw new ApiError("OFFLINE", "Couldn't reach Prequel. Check your connection.", 0);
  });

  const body = (await response.json().catch(() => null)) as
    (T & { message?: string; code?: string }) | null;

  if (!response.ok) {
    throw new ApiError(
      body?.code ?? `HTTP_${response.status}`,
      body?.message ?? "Something went wrong.",
      response.status,
    );
  }

  return body as T;
}
