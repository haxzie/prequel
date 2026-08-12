import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Main-process code is Node code; it never needs a DOM.
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      // Keeps test recordings out of the user's real Movies folder.
      PREQUEL_RECORDINGS_DIR: "/tmp/prequel-vitest-recordings",
    },
  },
});
