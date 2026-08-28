import { defineConfig, devices } from "@playwright/test";

const deployedBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  expect: { timeout: 15_000 },
  use: {
    baseURL: deployedBaseURL || "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--disable-gpu"] } },
    },
    {
      name: "firefox",
      testMatch: /(cross-browser-smoke|auth-live|r1-anonymous)\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testMatch: /(cross-browser-smoke|auth-live|r1-anonymous)\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: deployedBaseURL ? undefined : {
    command: "npm run dev -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
