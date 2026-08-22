/**
 * The Drizzle schema has to be what Better Auth thinks it is.
 *
 * There is no type relationship between the two. Better Auth looks its fields up
 * by name on a plain object at runtime, so a field it wants and the schema does
 * not have is not a compile error, and not a startup error either — the adapter
 * builds a `where` clause with an *empty column name* and D1 rejects the
 * statement. The first anybody hears of it is a user failing to sign in with
 * "internal error", with the real cause buried in a server log.
 *
 * That is exactly what happened with `account.issuer`, added in Better Auth 1.7:
 * every other table matched, the app booted, the Google consent screen worked,
 * and the callback died on `select ... where ( = ? and "account"."account_id" = ?)`.
 *
 * So this asks Better Auth itself what it expects — with the plugins this app
 * actually configures — and checks the schema against the answer. An upgrade
 * that adds a field now fails here rather than in production.
 */
import { getAuthTables } from "better-auth/db";
import { magicLink, organization } from "better-auth/plugins";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";

import { schema } from "@prequel/db";

/**
 * The same plugin set as `src/auth.ts`.
 *
 * Both plugins add columns — `activeOrganizationId` on `session`, and the whole
 * `organization`/`member`/`invitation` set — so checking without them would pass
 * against a schema missing all of it.
 */
const expected = getAuthTables({
  plugins: [magicLink({ sendMagicLink: async () => undefined }), organization({})],
});

/**
 * Every Drizzle table in the schema, keyed by its SQL table name.
 *
 * Widened to `unknown` before the guard. The schema namespace is a union of
 * tables *and* `Relations` objects, and a `value is SQLiteTable` predicate over
 * that union is rejected — the predicate's type has to be assignable to the
 * parameter's, and a table is not a relation. Drizzle's own `is` narrows fine
 * once the input stops claiming to be the union.
 */
const tables = new Map<string, SQLiteTable>();

for (const value of Object.values(schema) as unknown[]) {
  if (is(value, SQLiteTable)) tables.set(getTableName(value), value);
}

describe("the schema Better Auth expects", () => {
  for (const [model, definition] of Object.entries(expected)) {
    const tableName = definition.modelName;

    it(`has a \`${tableName}\` table`, () => {
      expect(tables.has(tableName)).toBe(true);
    });

    it(`has every field of \`${model}\``, () => {
      const table = tables.get(tableName);
      if (!table) throw new Error(`no \`${tableName}\` table in the schema`);

      // Keyed on the *property* name, not the column name. The adapter looks
      // fields up by the key on the exported object, so `emailVerified` is what
      // has to match — whatever the column underneath is called.
      const columns = Object.keys(getTableColumns(table));

      const missing = Object.keys(definition.fields).filter((field) => !columns.includes(field));

      expect(missing).toEqual([]);
    });

    it(`gives \`${model}\` a primary key`, () => {
      const table = tables.get(tableName);
      if (!table) throw new Error(`no \`${tableName}\` table in the schema`);

      // Better Auth assumes `id` on every model it owns and never declares it as
      // a field, so it would not be caught by the check above.
      expect(Object.keys(getTableColumns(table))).toContain("id");
    });
  }
});
