/**
 * Builds the `prequel` command into `out/cli/prequel.cjs`.
 *
 * Its own vite run rather than a fourth entry in `electron.vite.config.ts`,
 * for one reason: **format**. This package is `"type": "module"`, so
 * electron-vite emits ESM for main — and this file is not loaded by Electron,
 * it is handed to the Electron binary running as plain Node by a shell script
 * in `~/.local/bin`. A `.js` file under an `app.asar.unpacked` directory has no
 * nearby `package.json` to say what module system it is in, so Node reads it as
 * CommonJS and an ESM bundle dies on its first `import` with a syntax error
 * before anything can report why. `.cjs`, built as CommonJS, has no such
 * ambiguity.
 *
 * It also keeps the CLI out of the main bundle, which is loaded at launch by a
 * menu-bar app that should start instantly.
 */
import { build } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

await build({
  root,
  configFile: false,
  // Quiet: this runs inside `pnpm build`, behind electron-vite's own output.
  logLevel: "warn",
  build: {
    outDir: "out/cli",
    emptyOutDir: true,
    // The CLI is read by Node every time somebody types `prequel`, and an agent
    // types it a lot. Minified it parses in a few milliseconds.
    minify: true,
    target: "node22",
    lib: {
      entry: "src/cli/index.ts",
      formats: ["cjs"],
      fileName: () => "prequel.cjs",
    },
    rollupOptions: {
      // Node's own modules, and nothing else: everything the CLI imports from
      // `src/shared` is bundled in, so the file stands alone and a missing
      // `node_modules` beside it cannot break the command.
      external: [/^node:/],
    },
  },
});
