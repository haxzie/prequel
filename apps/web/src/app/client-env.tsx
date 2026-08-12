"use client";

import { env } from "@prequel/env";

/**
 * Client components can read `client` vars — Next inlines them at build time.
 * Reading a `server` var here throws instead of silently shipping a secret.
 */
export function ClientEnv() {
  return (
    <dl>
      <dt>NEXT_PUBLIC_APP_NAME</dt>
      <dd>{env.NEXT_PUBLIC_APP_NAME}</dd>

      <dt>NEXT_PUBLIC_APP_URL</dt>
      <dd>{env.NEXT_PUBLIC_APP_URL}</dd>
    </dl>
  );
}
