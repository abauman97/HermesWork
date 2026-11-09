import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: process.env.HERMES_PROJECTS_URL || "http://127.0.0.1:9137",
    reducedMotion: "reduce",
    screenshot: "only-on-failure",
    trace: "off",
  },
});
