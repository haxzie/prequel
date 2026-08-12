import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// The workspace root, where the single shared .env lives.
const envDir = resolve("../../");

// Renderer env vars use the same public prefix as the web app so both apps can
// share one schema in packages/env.
const envPrefix = ["VITE_", "NEXT_PUBLIC_"];

// Entry points follow electron-vite conventions: src/main/index.ts,
// src/preload/index.ts and src/renderer/index.html.
export default defineConfig({
  main: {
    envDir,
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
});
