/**
 * Refuses to package a build that points at a developer's machine.
 *
 * `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_API_URL` are baked into the main
 * bundle at build time — see `publicEnv` in `electron.vite.config.ts` — and
 * `.env` pins both to localhost so `pnpm dev` works with no setup. `pnpm install`
 * seeds that file from `.env.example`, including on a CI runner, so the default
 * path produces a signed, notarised `.dmg` whose Sign in button opens
 * `http://localhost:3000`.
 *
 * Nothing fails when that happens. The build is green, the disk image mounts,
 * the app runs — and the first anybody hears of it is a user reporting that
 * signing in goes nowhere. Hence a check rather than a comment: this is the one
 * class of mistake that only shows up after shipping.
 *
 * Runs in `package`, not `build`. A plain `electron-vite build` is how CI checks
 * the app still compiles, and that has no business caring which server it would
 * have talked to.
 */
import { loadEnv } from "vite";

/** The repo root, where the single `.env` lives. */
const ENV_DIR = new URL("../../../", import.meta.url).pathname;

/** Exactly the prefixes `electron.vite.config.ts` exposes. */
const PREFIXES = ["VITE_", "NEXT_PUBLIC_"];

/** What a build must not ship pointing at. */
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i;

const REQUIRED = {
  NEXT_PUBLIC_APP_URL: "where Sign in opens, and where a share link points",
  NEXT_PUBLIC_API_URL: "where the app uploads, signs in and transcribes",
};

// The same resolution the build performs: `.env` first, then anything already in
// the environment on top — which is what lets the release workflow override a
// checked-in localhost without editing the file.
const resolved = { ...loadEnv("production", ENV_DIR, PREFIXES) };
for (const key of Object.keys(REQUIRED)) {
  if (process.env[key]) resolved[key] = process.env[key];
}

const local = Object.entries(REQUIRED).filter(([key]) => LOCAL.test(resolved[key] ?? ""));

if (local.length > 0 && process.env["PREQUEL_ALLOW_LOCAL_URLS"] !== "1") {
  console.error("\nRefusing to package: this build would ship pointing at localhost.\n");

  for (const [key, what] of local) {
    console.error(`  ${key}=${resolved[key]}`);
    console.error(`    ${what}\n`);
  }

  console.error("Set them to the deployed origins for this build, for example:\n");
  console.error("  NEXT_PUBLIC_APP_URL=https://prequel.sh \\");
  console.error("  NEXT_PUBLIC_API_URL=https://api.prequel.sh \\");
  console.error("    pnpm --filter @prequel/desktop package\n");
  console.error("Packaging against a local server on purpose? PREQUEL_ALLOW_LOCAL_URLS=1\n");

  process.exit(1);
}

for (const key of Object.keys(REQUIRED)) {
  console.log(`${key}=${resolved[key] ?? "(unset — the schema default applies)"}`);
}
