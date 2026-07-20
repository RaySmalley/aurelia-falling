import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/viewport",
  outputDir: "test-results/viewport",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    baseURL: "http://localhost:4000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});
