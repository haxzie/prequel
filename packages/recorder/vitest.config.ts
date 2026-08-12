import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    // Threads, not vitest's default forked processes. macOS grants Screen
    // Recording per process, and a forked worker does not inherit it: the same
    // `listTargets()` that works in-process fails with SCREEN_ACCESS_DENIED
    // from a fork. Threads share the grant because they share the process.
    pool: "threads",
    // The addon is a real .node file; it must not be transformed or inlined.
    server: { deps: { external: [/\.node$/] } },
  },
});
