/**
 * Reading one value out of D1.
 *
 * `noUncheckedIndexedAccess` is on across this repo, so destructuring
 * `const [[count]] = await statement.raw()` does not typecheck — both indices
 * are possibly undefined and TypeScript is right about both. This says so once
 * instead of at every call site.
 */
export async function scalar<T>(statement: D1PreparedStatement): Promise<T | undefined> {
  const [row] = await statement.raw<[T]>();
  return row?.[0];
}
