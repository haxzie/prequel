/**
 * Vite's `?raw` suffix, which TypeScript knows nothing about.
 *
 * One test reads `wrangler.jsonc` as text to check that the cron expression
 * the code branches on is one the deploy actually fires. The file is JSONC and
 * carries comments, so it cannot be imported as JSON — and without this
 * declaration `tsc --noEmit` fails on the import while vitest runs it happily,
 * which is a green suite and a red typecheck.
 */
declare module "*?raw" {
  const contents: string;
  export default contents;
}
