import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      "@hermes/plugin-sdk": new URL("./tests/frontend/sdk.ts", import.meta.url)
        .pathname,
    },
  },
  test: { include: ["tests/frontend/**/*.test.ts*"], environment: "jsdom" },
});
