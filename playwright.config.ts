import { defineConfig } from "@playwright/test";

// End-to-end tests: each one starts its own Basis with a stand-in agent (see test/e2e/basis.ts).
export default defineConfig({
  testDir: "test/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // One Basis at a time: each instance runs two Vite servers, and the ports follow the worker.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { viewport: { width: 1600, height: 1000 }, trace: "retain-on-failure" },
});
