import { drizzle } from "drizzle-orm/d1";

import { schema } from "@prequel/db";

import type { Env } from "./env.ts";

export type Database = ReturnType<typeof database>;

/**
 * A Drizzle client over the D1 binding.
 *
 * Built per request rather than cached in a module-level variable. A Worker
 * isolate is reused across requests but the `env` it is given belongs to one of
 * them, and holding a client built from an earlier request's binding is how a
 * preview deployment ends up writing to production's database.
 */
export function database(env: Env) {
  return drizzle(env.DB, { schema, logger: false });
}
