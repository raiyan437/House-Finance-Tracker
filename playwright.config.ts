import { defineConfig, devices } from "@playwright/test";

const deployedBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
const criticalJourneys = process.env.HFT_CRITICAL_E2E === "1";
if (criticalJourneys && (deployedBaseURL || process.env.APP_COMPOSITION !== "local")) {
  throw new Error("Critical fixture journeys require APP_COMPOSITION=local and no PLAYWRIGHT_BASE_URL.");
}
const secondaryBrowserSpecs = criticalJourneys
  ? /(household-onboarding|household-management|expenses|settlements|cards|ui-redesign)\.spec\.ts/
  : /(cross-browser-smoke|auth-live|r1-anonymous|session-resilience)\.spec\.ts/;

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
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--disable-gpu"] } },
    },
    {
      name: "firefox",
      testMatch: secondaryBrowserSpecs,
      ...(criticalJourneys ? { grep: /@critical/ } : {}),
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testMatch: secondaryBrowserSpecs,
      ...(criticalJourneys ? { grep: /@critical/ } : {}),
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: deployedBaseURL ? undefined : {
    command: process.env.SESSION_RESILIENCE_E2E === "1"
      ? "npm run start -- --hostname 127.0.0.1"
      : "npm run dev -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI && !criticalJourneys,
    timeout: 120_000,
  },
});
