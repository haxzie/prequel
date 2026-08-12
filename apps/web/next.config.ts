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
};

export default nextConfig;
