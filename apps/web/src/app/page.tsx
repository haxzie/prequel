import { env } from "@prequel/env";

import { ClientEnv } from "./client-env";

// Server component — both `server` and `client` vars are readable here.
export default function Home() {
  return (
    <main>
      <h1>{env.NEXT_PUBLIC_APP_NAME}</h1>
      <p>Next.js app in a pnpm + turborepo workspace.</p>

      <h2>On the server</h2>
      <dl>
        <dt>NODE_ENV</dt>
        <dd>{env.NODE_ENV}</dd>

        <dt>DATABASE_URL</dt>
        <dd>{env.DATABASE_URL ? "configured" : "not set"}</dd>

        <dt>API_SECRET</dt>
        <dd>{env.API_SECRET ? "configured" : "not set"}</dd>
      </dl>

      <h2>On the client</h2>
      <ClientEnv />

      <p>
        Env vars are declared in <code>packages/env/src/env.ts</code>.
      </p>
    </main>
  );
}
