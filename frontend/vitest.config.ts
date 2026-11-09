import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: {
      react: new URL("./node_modules/react", import.meta.url).pathname,
      "@hermes/plugin-sdk": new URL("./tests/frontend/sdk.ts", import.meta.url)
        .pathname,
    },
  },
  test: { include: ["tests/frontend/**/*.test.ts*"], environment: "jsdom" },
});
