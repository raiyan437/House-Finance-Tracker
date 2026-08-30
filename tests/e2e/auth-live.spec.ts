import { existsSync, readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const CREDS_FILE = ".env.auth-smoke.local";
const enabled = process.env.AUTH_SMOKE === "1" && existsSync(CREDS_FILE);

function credentials(): { email: string; password: string } {
  const raw = readFileSync(CREDS_FILE, "utf8");
  const read = (key: string) => {
    const match = new RegExp(`^${key}=(.*)$`, "m").exec(raw);
    return match ? match[1].trim() : "";
  };
  const email = read("TEST_EMAIL");
  const password = read("TEST_PASSWORD");
  if (!email || !password) throw new Error("auth smoke credentials are incomplete.");
  return { email, password };
}

function envValue(file: string, key: string): string {
  if (!existsSync(file)) return "";
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(readFileSync(file, "utf8"));
  return match ? match[1].trim() : "";
}

interface BrowserDiagnostics {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly hydrationErrors: string[];
}

const diagnostics = new Map<string, BrowserDiagnostics>();

function safeDiagnosticSummary(messages: readonly string[]): string {
  return messages
    .map((message) => message
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
      .replace(/[A-Za-z0-9_-]{32,}/g, "[opaque-value]")
      .slice(0, 240))
    .join(" | ");
}

function attachDiagnostics(page: Page, target: BrowserDiagnostics): void {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    target.consoleErrors.push(message.text());
    if (/hydration|hydrated|server rendered html/i.test(message.text())) target.hydrationErrors.push(message.text());
  });
  page.on("pageerror", (error) => target.pageErrors.push(error.message));
}

function beginDiagnostics(context: BrowserContext, page: Page, testInfo: TestInfo): void {
  const target: BrowserDiagnostics = { consoleErrors: [], pageErrors: [], hydrationErrors: [] };
  diagnostics.set(testInfo.testId, target);
  attachDiagnostics(page, target);
  context.on("page", (openedPage) => {
    if (openedPage !== page) attachDiagnostics(openedPage, target);
  });
}

test.skip(!enabled, "Live auth smoke is opt-in: set AUTH_SMOKE=1 and populate .env.auth-smoke.local.");

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial", retries: 0 });

test.describe("live Appwrite authentication", () => {
  let email = "";
  let password = "";
  let loginIdentity = 0;
  const loginRunOffset = process.pid % 200;

  test.beforeAll(({ browser }) => {
    void browser;
    ({ email, password } = credentials());
  });

  test.beforeEach(async ({ context, page }, testInfo) => {
    beginDiagnostics(context, page, testInfo);
  });

  test.afterEach(async ({}, testInfo) => {
    const result = diagnostics.get(testInfo.testId);
    diagnostics.delete(testInfo.testId);
    if (!result) throw new Error("Browser diagnostics were not initialized.");
    const expectedRevocation401 = testInfo.title.startsWith("logout revokes the current remote session");
    const unexpectedConsoleErrors = result.consoleErrors.filter((message) =>
      !(expectedRevocation401 && /Failed to load resource: the server responded with a status of 401/i.test(message))
    );
    if (result.hydrationErrors.length > 0) throw new Error(`Unexpected hydration errors: ${result.hydrationErrors.length}.`);
    if (result.pageErrors.length > 0) throw new Error(`Unexpected page errors: ${result.pageErrors.length}: ${safeDiagnosticSummary(result.pageErrors)}`);
    if (unexpectedConsoleErrors.length > 0) throw new Error(`Unexpected console errors: ${unexpectedConsoleErrors.length}: ${safeDiagnosticSummary(unexpectedConsoleErrors)}`);
  });

  async function login(page: import("@playwright/test").Page) {
    loginIdentity += 1;
    const addressSuffix = ((loginRunOffset + loginIdentity) % 250) + 1;
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${addressSuffix}` });
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();
    // R1: the temporary milestone is gone; the real product shell renders.
    await page.waitForSelector('[data-slot="app-shell"]', { timeout: 20000 });
    await page.setExtraHTTPHeaders({});
  }

  test("login reaches the real product surface with hardened session cookie", async ({ page, browserName }, testInfo) => {
    await page.goto("/login");
    const axeResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axeResults.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

    
    await expect(async () => {
      const jar = await page.context().cookies();
      if (!jar.some((cookie) => cookie.name === "hft_session" && cookie.value.length > 0)) {
        await login(page);
        throw new Error("Session cookie not persisted yet; retrying login.");
      }
    }).toPass({ timeout: 30000, intervals: [400] });

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((cookie) => cookie.name === "hft_session");
    expect(cookies.some((cookie) => cookie.name === "hft_session")).toBe(true);
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.secure).toBe(new URL(String(testInfo.project.use.baseURL)).protocol === "https:");
    if (browserName === "webkit") {
      expect(["Lax", "None"]).toContain(sessionCookie?.sameSite);
    } else {
      expect(sessionCookie?.sameSite).toBe("Lax");
    }
    expect(sessionCookie?.path).toBe("/");
    expect(sessionCookie?.expires).toBeGreaterThan(Date.now() / 1000 + 60 * 60 * 24 * 30);

    await page.goto("/dashboard");
    await expect(page.locator('[data-slot="app-shell"]')).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open development tools" })).toHaveCount(0);
    const productionDatabases = await page.evaluate(() => indexedDB.databases().then((entries) => entries.map((entry) => entry.name)));
    expect(productionDatabases.some((name) => typeof name === "string" && name.toLowerCase().includes("finance"))).toBe(false);
  });

  test("restores the session on reload and in a new tab without client-supplied identity", async ({ page, context }) => {
    await page.goto("/login");
    await login(page);
    await page.reload();
    await expect(page.locator('[data-slot="app-shell"]')).toBeVisible();

    const secondTab = await context.newPage();
    await secondTab.goto("/household");
    await expect(secondTab.locator('[data-slot="app-shell"]')).toBeVisible();
    await expect(secondTab.getByRole("heading", { name: "Household", exact: true })).toBeVisible();

    const databases = await secondTab.evaluate(() => indexedDB.databases().then((entries) => entries.map((entry) => entry.name)));
    expect(databases.some((name) => typeof name === "string" && name.toLowerCase().includes("finance"))).toBe(false);
    await secondTab.close();
  });

  test("anonymous protected-route access redirects to login", async ({ browser }) => {
    const anonymous = await browser.newContext();
    const page = await anonymous.newPage();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await anonymous.close();
  });

  test("forgot-password returns the enumeration-safe generic confirmation", async ({ page, browserName }) => {
    const recoveryIdentity = browserName === "chromium" ? 10 : browserName === "firefox" ? 11 : 12;
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `203.0.113.${recoveryIdentity}` });
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send recovery link" }).click();
    await expect(page.getByText("If an account exists for that email, a recovery link has been sent. The link expires in one hour.")).toBeVisible();
  });

  test("unknown account receives the same generic forgot-password response", async ({ page, browserName }) => {
    await page.goto("/forgot-password");
    const unknownAddress = `non-provisioned-${browserName}-${Date.now()}@example.com`;
    await page.getByLabel("Email").fill(unknownAddress);
    await page.getByRole("button", { name: "Send recovery link" }).click();
    await expect(page.getByText("If an account exists for that email, a recovery link has been sent. The link expires in one hour.")).toBeVisible();
  });

  test("allowlisted Signup is canonical while verification and production email-edit routes remain unavailable", async ({ page }) => {
    await page.goto("/register");
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible();
    await page.getByLabel("Email").fill(`not-allowed-${Date.now()}@example.com`);
    await page.getByLabel("Password", { exact: true }).fill("unused-password");
    await page.getByLabel("Confirm Password").fill("unused-password");
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByRole("alert")).toHaveText("Email not allowed. Contact admin.");

    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Create Account" }).click();
    await expect(page.getByRole("alert")).toHaveText("An account already exists for this email. Sign in or reset your password.");
    await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "reset your password" })).toBeVisible();

    const unavailable = await Promise.all([
      page.request.post("/api/auth/register", { data: {} }),
      page.request.post("/api/auth/verification/resend", { data: {} }),
      page.request.post("/api/auth/email-change", { data: {} }),
    ]);
    for (const response of unavailable) expect([404, 405]).toContain(response.status());

    const removedPage = await page.request.get("/verify-email");
    expect(removedPage.status()).toBe(404);
  });

  test("Profile exposes the responsive Password section without changing a production password", async ({ page }) => {
    await page.goto("/login");
    await login(page);
    for (const viewport of [
      { width: 430, height: 932 },
      { width: 390, height: 844 },
      { width: 360, height: 800 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/profile");
      await expect(page.getByRole("heading", { name: "Password" })).toBeVisible();
      await expect(page.getByLabel("Current Password")).toHaveAttribute("autocomplete", "current-password");
      await expect(page.getByLabel("New Password")).toHaveAttribute("autocomplete", "new-password");
      await expect(page.getByLabel("Confirm New Password")).toHaveAttribute("autocomplete", "new-password");
      const button = page.getByRole("button", { name: "Update Password" });
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const axeResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axeResults.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
    }
  });

  test("reset-password rejects an incomplete link without mutating the account", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByText("This reset link is incomplete. Request a new recovery email.")).toBeVisible();
  });

  test("logout revokes the current remote session, clears the cookie, and re-gates protected routes", async ({ page, browser }, testInfo) => {
    await page.goto("/login");
    await login(page);
    const beforeLogout = await page.context().cookies();
    const priorSession = beforeLogout.find((cookie) => cookie.name === "hft_session");
    if (!priorSession) throw new Error("Expected a session cookie before logout.");

    await page.getByRole("button", { name: "Log Out" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 20000 });
    const cookies = await page.context().cookies();
    expect(cookies.some((cookie) => cookie.name === "hft_session" && cookie.value.length > 0)).toBe(false);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    const revokedContext = await browser.newContext();
    await revokedContext.addCookies([{
      name: priorSession.name,
      value: priorSession.value,
      url: String(testInfo.project.use.baseURL),
      httpOnly: true,
      sameSite: "Lax",
    }]);
    const revokedPage = await revokedContext.newPage();
    // This isolated adversarial page intentionally receives 401 responses for
    // the revoked cookie. Its URL and cookie assertions below are authoritative;
    // keep those expected browser resource messages out of the ordinary-page
    // zero-console-error gate.
    await revokedPage.goto("/dashboard");
    await expect(revokedPage).toHaveURL(/\/login$/);
    const revokedCookies = await revokedContext.cookies();
    expect(revokedCookies.some((cookie) => cookie.name === "hft_session" && cookie.value.length > 0)).toBe(false);
    await revokedContext.close();
  });

  test("mobile More logout uses the production logout workflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await login(page);

    await page.getByRole("button", { name: "More" }).click();
    const dialog = page.getByRole("dialog", { name: "More" });
    const logout = dialog.getByRole("button", { name: "Log Out" });
    await expect(logout).toBeVisible();
    expect((await logout.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await logout.click();

    await expect(page).toHaveURL(/\/login$/, { timeout: 20000 });
    const cookies = await page.context().cookies();
    expect(cookies.some((cookie) => cookie.name === "hft_session" && cookie.value.length > 0)).toBe(false);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("browser HTML and client scripts contain no configured or session secrets", async ({ page }) => {
    await login(page);
    const cookie = (await page.context().cookies()).find((entry) => entry.name === "hft_session");
    if (!cookie) throw new Error("Expected a session cookie for the browser secret audit.");

    const sensitiveValues = [
      envValue(".env.local", "HFT_APPWRITE_RUNTIME_API_KEY"),
      envValue(".env.local", "APPWRITE_BOOTSTRAP_API_KEY"),
      envValue(".env.local", "APPWRITE_PROVISIONING_API_KEY"),
      envValue(".env.local", "HFT_AUTH_HMAC_SECRET"),
      envValue(CREDS_FILE, "TEST_PASSWORD"),
      cookie.value,
    ].filter((value) => value.length > 0);
    const forbiddenNames = [
      "HFT_APPWRITE_RUNTIME_API_KEY",
      "APPWRITE_BOOTSTRAP_API_KEY",
      "APPWRITE_PROVISIONING_API_KEY",
      "HFT_AUTH_HMAC_SECRET",
    ];

    const documents = [await page.content()];
    const scriptUrls = await page.evaluate(() =>
      performance.getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => name.startsWith(location.origin) && /\.js(?:\?|$)/.test(name)),
    );
    for (const url of scriptUrls) {
      const response = await page.request.get(url);
      if (response.ok()) documents.push(await response.text());
    }
    const exposed = documents.some((document) =>
      forbiddenNames.some((name) => document.includes(name)) || sensitiveValues.some((value) => document.includes(value)),
    );
    if (exposed) throw new Error("A configured or session secret was found in browser-visible content.");
  });
});
