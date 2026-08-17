import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @prequel/env ships raw TypeScript, so Next compiles it as part of the app.
  // This is also what lets Next inline the NEXT_PUBLIC_* values it reads.
  //
  // Note: do not import @prequel/env from this file — next.config.ts is loaded
  // by Node before that transpilation applies. Env validation runs from
  // src/instrumentation.ts instead.
  transpilePackages: ["@prequel/env"],

  // Blog posts are .mdx modules imported by a route, so Next has to recognise
  // the extension. Pages themselves are still .tsx.
  pageExtensions: ["ts", "tsx", "mdx"],

  // Turns a href that does not match a real route into a typecheck error.
  // Stable in 16 — it is no longer under `experimental`.
  typedRoutes: true,

  images: {
    // Next 16 defaults this to [75] and silently coerces anything else to the
    // nearest allowed value. The product screenshot is dense UI text, where 75
    // shows visible ringing around the glyphs.
    qualities: [75, 90],
  },

  experimental: {
    // Turbopack looks for a PostCSS config at the *project* root before the
    // stylesheet's own directory, and in this workspace the project root is the
    // repo root, not apps/web. Without this flag postcss.config.mjs beside this
    // file can be skipped: Tailwind never runs, every page renders unstyled and
    // nothing reports an error. New in 16.3.
    turbopackLocalPostcssConfig: true,
  },
};

// Plugins must be named as strings. Turbopack runs them in Rust and cannot be
// handed a JavaScript function, so anything configured with a callback — most
// syntax highlighters — is unusable here.
const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-gfm"],
  },
});

export default withMDX(nextConfig);
