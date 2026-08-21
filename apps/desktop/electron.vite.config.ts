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
 * That is how `NEXT_PUBLIC_APP_URL` comes to be `http://localhost:3000` in a
 * shipped build, which is wrong for anything that actually calls it.
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

// Entry points follow electron-vite conventions: src/main/index.ts,
// src/preload/index.ts and src/renderer/index.html.
export default defineConfig(({ mode }) => ({
  main: {
    envDir,
    define: publicEnv(mode),
    // @prequel/env ships raw TypeScript, so it must be bundled rather than
    // externalized like the other dependencies.
    plugins: [externalizeDepsPlugin({ exclude: ["@prequel/env"] })],
  },
  preload: {
    envDir,
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    envDir,
    envPrefix,
    resolve: {
      alias: { "@": resolve("src/renderer/src") },
    },
    plugins: [react(), tailwindcss()],
  },
}));
