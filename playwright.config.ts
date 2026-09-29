import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Each test gets a fresh browser profile and mock backend on a fixed port, so run them one at a time
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
});
