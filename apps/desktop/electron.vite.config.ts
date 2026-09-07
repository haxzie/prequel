import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin, loadEnv } from "electron-vite";

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The workspace root, where the single shared .env lives.
const envDir = resolve("../../");

// Renderer env vars use the same public prefix as the web app so both apps can
// share one schema in packages/env.
const envPrefix = ["VITE_", "NEXT_PUBLIC_"];

/**
 * The public env values, baked into the main bundle.
 *
 * Main is a Node process, not a browser one, so `@prequel/env` reads these from
 * `process.env` at runtime — and a packaged app is launched by Finder with none
 * of them set, so every one of them silently falls back to its schema default.
 * That is how `NEXT_PUBLIC_APP_URL` comes to be whatever the schema defaults
 * to in a shipped build, which is wrong for anything that actually calls it.
 *
 * Replaced statically instead, the way the renderer already gets them. The
 * value is whatever `.env` held when the bundle was built, which is the only
 * moment it can be known.
 */
function publicEnv(mode: string): Record<string, string> {
  const loaded = loadEnv(mode, envDir, envPrefix);

  return Object.fromEntries(
    Object.entries(loaded).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)]),
  );
}

/**
 * Minification, which electron-vite does not do on its own.
 *
 * Vite minifies a production build by default; electron-vite overrides that to
 * `false` for all three bundles, on the reasoning that a desktop app is not
 * downloading its own JavaScript. But it is *reading* it: a shipped renderer
 * came to 1.1 MB across 29,654 lines with comments and original identifiers
 * intact, and every window pays to parse that at launch. Minified it is 502 KB,
 * and main goes from 353 KB to 141 KB.
 *
 * Set here rather than left to the default so that nothing in the bundle is
 * name-dependent — IPC channels, protocol schemes and `nativeImage` paths are
 * all strings, and nothing reads `Function.prototype.name`.
 */
const minify = { build: { minify: true } } as const;

// Entry points follow electron-vite conventions: src/main/index.ts,
// src/preload/index.ts and src/renderer/index.html.
export default defineConfig(({ mode }) => ({
  main: {
    ...minify,
    envDir,
    define: publicEnv(mode),
    // @prequel/env ships raw TypeScript, so it must be bundled rather than
    // externalized like the other dependencies.
    plugins: [externalizeDepsPlugin({ exclude: ["@prequel/env"] })],
  },
  preload: {
    ...minify,
    envDir,
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    ...minify,
    envDir,
    envPrefix,
    resolve: {
      alias: { "@": resolve("src/renderer/src") },
    },
    plugins: [react(), tailwindcss()],
  },
}));
