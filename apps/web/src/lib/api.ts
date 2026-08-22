/**
 * Calling the API from the web app.
 *
 * Everything is a Worker on another origin now, which changes two things about
 * every call the site makes. Cookies are not sent unless asked for, and a
 * failure is a network error as often as it is a status code.
 */
import { env } from "@prequel/env";

export const API_URL = env.NEXT_PUBLIC_API_URL;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * A call from the browser, carrying the session cookie.
 *
 * `credentials: "include"` is the whole point of this wrapper. Without it the
 * browser sends nothing to another origin, and every authenticated call comes
 * back 401 while the user is plainly signed in — which looks like a broken
 * session rather than a missing option.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  }).catch(() => {
    throw new ApiError("Couldn't reach Prequel. Check your connection.", 0);
  });

  const body = (await response.json().catch(() => null)) as
    (T & { message?: string; code?: string }) | null;

  if (!response.ok) {
    throw new ApiError(body?.message ?? "Something went wrong.", response.status, body?.code);
  }

  return body as T;
}
