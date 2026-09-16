/**
 * The gallery: the renderer's components in an ordinary browser, for the
 * documentation's screenshots.
 *
 *   pnpm --filter @prequel/desktop gallery      # then open http://127.0.0.1:5199/#/
 *   pnpm --filter @prequel/desktop shots        # capture every shot to apps/web/public/docs
 *
 * A second Vite root beside the electron-vite one, not a mode of it: the
 * renderer bundle assumes a preload has put `window.prequel` there and that
 * `prequel-media://` resolves. Here `gallery/main.tsx` installs a stub for the
 * first and this config swaps the module behind the second.
 */
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { describe, mediaServer, optionsFromEnv } from "./server/media.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const REAL_MEDIA_URL = here("../src/shared/media-url.ts");
const GALLERY_MEDIA_URL = here("./media-url.ts");

/**
 * Every import of `shared/media-url` gets the gallery's copy instead.
 *
 * Matched on the *resolved* path rather than the specifier: the renderer spells
 * it `../../../shared/media-url` from one depth and `../../../../shared/...`
 * from another, and a regex on the string would have to know every spelling.
 * `skipSelf` stops the resolve from re-entering this hook.
 */
function mediaUrlSwap(): Plugin {
  return {
    name: "prequel-gallery-media-url",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!source.includes("media-url")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && resolved.id === REAL_MEDIA_URL) return GALLERY_MEDIA_URL;
      return null;
    },
  };
}

const options = optionsFromEnv();
console.log(`[gallery] ${describe(options)}`);

export default defineConfig({
  root: here("."),
  // Fixed so the capture script and a person can both find it. Strict, because
  // a fallback port is a script screenshotting somebody else's dev server.
  server: {
    port: 5199,
    strictPort: true,
    host: "127.0.0.1",
    // The gallery imports `../src/**`; without this Vite answers those imports
    // with a 403 that reads as a missing module.
    fs: { allow: [here("..")] },
  },
  resolve: {
    alias: { "@": here("../src/renderer/src") },
  },
  // No `envDir`: nothing under `src/renderer/src` reads `env.ts`, so the
  // components render without a single environment variable.
  plugins: [mediaUrlSwap(), react(), tailwindcss(), mediaServer(options)],
});
