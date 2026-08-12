/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  This is the file you edit to add an environment variable.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  1. Add it to `server` (secret) or `client` (safe to expose).
 *  2. Add the matching line to `runtimeEnv` below — bundlers only inline env
 *     accesses they can see written out literally.
 *  3. Document it in the root `.env.example`.
 *
 *  Then read it anywhere with:  import { env } from "@prequel/env"
 */
import { z } from "zod";

import { createEnv } from "./create-env.ts";

/** Public variables must carry this prefix so Next.js/Vite will expose them. */
export const CLIENT_PREFIX = "NEXT_PUBLIC_";

/** Never sent to the browser or the Electron renderer. */
export const server = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url().optional(),
  API_SECRET: z.string().min(1).optional(),
};

/** Safe to ship to the client. Treat everything here as public. */
export const client = {
  NEXT_PUBLIC_APP_NAME: z.string().min(1).default("Prequel"),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
};

function build() {
  return createEnv({
    server,
    client,
    clientPrefix: CLIENT_PREFIX,
    // Written out one-by-one on purpose: this is what makes the bundler
    // inline the NEXT_PUBLIC_* values into the client bundle.
    runtimeEnv: {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL,
      API_SECRET: process.env.API_SECRET,
      NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    },
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  });
}

export type Env = ReturnType<typeof build>;

let cached: Env | undefined;

/**
 * Validates immediately and returns the env. Call this at process startup
 * (next.config.ts, Electron main) so a bad config fails the build/boot rather
 * than the first request.
 */
export function validateEnv(): Env {
  cached ??= build();
  return cached;
}

/**
 * The environment, validated on first property access.
 *
 * Access is lazy so that merely importing this module from a context without
 * `process` — the Electron renderer, a browser bundle — does not blow up. Those
 * contexts build their own env from the exported `client` schema instead.
 */
export const env: Env = new Proxy({} as Env, {
  get: (_target, prop) => Reflect.get(validateEnv() as object, prop),
  has: (_target, prop) => prop in (validateEnv() as object),
  ownKeys: () => Reflect.ownKeys(validateEnv() as object),
  getOwnPropertyDescriptor: (_target, prop) =>
    Reflect.getOwnPropertyDescriptor(validateEnv() as object, prop),
});
