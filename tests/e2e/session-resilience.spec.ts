import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PRODUCTION_R2_CAPABILITIES, PRODUCTION_R4_CAPABILITIES } from "../../src/application/runtime-capabilities";
import { resolve } from "node:path";
import { serializeWithBigInt } from "../../src/application/transport/json-bigint";
import { deterministicSeedData } from "../../src/infrastructure/indexeddb/seed";

// Production composition with intercepted API fixtures; no live business mutations.
test.beforeEach(async ({ page }) => {
  // Only later explicit fixtures may handle API calls; unmatched requests never reach a provider.
  await page.route("**/api/**", (route) => route.abort());
  await page.route("**/api/app/notifications/latest", (route) => route.fulfill({ json: { data: { notifications: [], unreadCount: 0 } } }));
});
function bootstrap() {
  return { data: {
    session: { userId: "fixture-user", displayName: "Fixture", displayEmail: "fixture@example.test", profileVersion: 1, roleLabel: "No active household", settlementActionCount: 0 },
    household: { status: "no-household" },
    capabilities: { ...PRODUCTION_R2_CAPABILITIES, profileMutations: true },
    businessDate: "2026-10-03",
  } };
}

async function resume(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
  });
}

async function waitForReadySession(page: Page) {
  await page.bringToFront();
  const checked = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/app/bootstrap" && response.status() === 200,
  );
  await resume(page);
  await checked;
  await expect(page.getByRole("status", { name: "Loading page", exact: true })).toHaveCount(0);
}

test.describe("production session resilience", () => {
  test("phone Expense dates remain below comments in the Appwrite read composition", async ({ page }, testInfo) => {
    const seed = deterministicSeedData();
    const fixture = bootstrap();
    const expense = seed.expenses[0];
    const active = { data: { ...fixture.data,
      session: { ...fixture.data.session, userId: expense.payerId, displayName: "Raiyan", roleLabel: "Leader", householdName: seed.household.name },
      household: { status: "active-leader", household: seed.household, page: { household: seed.household, members: [] }, joinRequests: [] },
    } };
    await page.route("**/api/app/bootstrap", (route) => route.fulfill({ contentType: "application/json", body: serializeWithBigInt(active) }));
    await page.route("**/api/app/household-members**", (route) => route.fulfill({ json: { data: [{ userId: expense.payerId, displayName: "Raiyan", status: "active" }] } }));
    await page.route("**/api/app/expenses?**", (route) => route.fulfill({ contentType: "application/json", body: serializeWithBigInt({ data: [{ expense, settlementStatus: "unsettled", commentCount: 2 }] }) }));
    await page.goto("/expenses?month=2026-08");
    await expect(page.getByRole("link", { name: "Open Groceries expense details" })).toBeVisible();
    const row = page.locator(".journey-expense-row").first();
    for (const width of [320, 390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const metadata = row.locator('[data-slot="expense-mobile-metadata"]');
      if (width < 900) {
        const comments = await metadata.locator('span:not([role]):has(svg)').boundingBox();
        const date = await metadata.locator("time").boundingBox();
        expect(comments).not.toBeNull();
        expect(date).not.toBeNull();
        if (width < 640) expect(date!.y).toBeGreaterThanOrEqual(comments!.y + comments!.height);
        else expect(date!.y).toBeLessThan(comments!.y + comments!.height);
      } else {
        await expect(metadata).toBeHidden();
        await expect(row.locator('time:visible')).toHaveAttribute("datetime", "2026-08-10");
      }
      await expect(row).toContainText("৳300.00");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 390 || width === 1440) await page.screenshot({ path: testInfo.outputPath(`production-expense-date-${width}.png`) });
    }
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.filter(item => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  });

  test("idle resume shows an animated page loader and retains the exact draft node", async ({ page }, testInfo) => {
    let calls = 0;
    let releaseCheck: () => void = () => undefined;
    const check = new Promise<void>((resolve) => { releaseCheck = resolve; });
    await page.route("**/api/app/bootstrap", async (route) => {
      if (++calls > 1) await check;
      await route.fulfill({ json: bootstrap() });
    });
    await page.goto("/profile");
    const name = page.getByRole("textbox", { name: "Display Name", exact: true });
    await name.fill("Idle draft");
    await name.evaluate((element) => Reflect.set(window, "idleDraftNode", element));
    try {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await resume(page);
      const loader = page.getByRole("status", { name: "Loading page", exact: true });
      await expect(loader).toBeVisible();
      await expect(page.locator("main")).toHaveAttribute("aria-busy", "true");
      await expect(page.locator('[data-slot="route-surface"]')).toHaveAttribute("inert", "");
      await expect(page.getByText("Checking your connection. Please wait before saving.")).toHaveCount(0);
      await expect(name).toBeHidden();
      expect(await page.locator('input[name="displayName"]').evaluate((element) => element === Reflect.get(window, "idleDraftNode"))).toBe(true);
      await expect(loader.locator("svg")).toHaveCSS("animation-iteration-count", "infinite");
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await expect(page.getByRole("navigation", { name: width === 1440 ? "Header navigation" : "Mobile navigation", exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`idle-loader-${width}.png`) });
      }
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axe.violations.filter(item => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(loader.locator("svg")).toHaveCSS("animation-iteration-count", "1");
      await expect.poll(() => calls).toBe(2);
    } finally { releaseCheck(); }
    await expect(page.getByRole("status", { name: "Loading page", exact: true })).toHaveCount(0);
    await expect(name).toHaveValue("Idle draft");
    expect(await name.evaluate((element) => element === Reflect.get(window, "idleDraftNode"))).toBe(true);
    await expect(page.locator('[data-slot="route-surface"]')).not.toHaveAttribute("inert", "");
  });

  for (const width of [390, 1440]) {
    test(`navigation remains usable through resume and delayed page reads at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const fixture = bootstrap();
      const household = { householdId: "fixture-household", name: "Fixture Home", code: "000000001", leaderId: "fixture-user", createdAt: "2026-10-03T00:00:00.000Z" };
      const active = { ...fixture, data: { ...fixture.data, household: { status: "active-leader", household, page: { household, members: [] }, joinRequests: [] } } };
      let calls = 0;
      let releaseCheck: () => void = () => undefined;
      let releaseExpenses: () => void = () => undefined;
      let releaseSettlements: () => void = () => undefined;
      const check = new Promise<void>((resolve) => { releaseCheck = resolve; });
      const expenses = new Promise<void>((resolve) => { releaseExpenses = resolve; });
      const settlements = new Promise<void>((resolve) => { releaseSettlements = resolve; });
      await page.route("**/api/app/bootstrap", async (route) => { if (++calls > 1) await check; await route.fulfill({ json: active }); });
      await page.route("**/api/app/household-members**", (route) => route.fulfill({ json: { data: [] } }));
      await page.route("**/api/app/expenses?**", async (route) => { await expenses; await route.fulfill({ json: { data: [] } }); });
      await page.route("**/api/app/settlements?**", async (route) => {
        await settlements;
        await route.fulfill({ contentType: "application/json", body: serializeWithBigInt({ data: { householdId: "fixture-household", currentUserId: "fixture-user", summary: { youOwe: BigInt(0), youAreOwed: BigInt(0), settled: true }, recommendations: [], pending: [], history: [], actionablePendingCount: 0 } }) });
      });
      await page.goto("/profile");
      await expect(page.getByRole("textbox", { name: "Display Name", exact: true })).toBeVisible();
      try {
        await resume(page);
        await expect(page.getByRole("status", { name: "Loading page", exact: true })).toBeVisible();
        const firstNav = page.getByRole("navigation", { name: width === 1440 ? "Header navigation" : "Mobile navigation", exact: true });
        await firstNav.getByRole("link", { name: width === 1440 ? "Navigate to Expenses" : "Expenses", exact: true }).click();
        await expect(page).toHaveURL(/\/expenses$/);
        await expect(firstNav.locator('[aria-current="page"]')).toHaveAttribute("href", "/expenses");
        await expect(page.getByRole("status", { name: "Loading page", exact: true })).toBeVisible();
        releaseCheck();
        await expect(page.getByRole("status", { name: "Loading expenses", exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`expenses-loader-${width}.png`) });
        const nextNav = page.getByRole("navigation", { name: width === 1440 ? "Primary navigation" : "Mobile navigation", exact: true });
        await nextNav.getByRole("link", { name: "Settlements", exact: true }).click();
        await expect(page).toHaveURL(/\/settlements$/);
        await expect(page.getByRole("status", { name: "Loading settlements", exact: true })).toBeVisible();
        await expect(nextNav.locator('[aria-current="page"]')).toHaveAttribute("href", "/settlements");
        await page.screenshot({ path: testInfo.outputPath(`settlements-loader-${width}.png`) });
        releaseSettlements();
        await expect(page.getByRole("heading", { name: "Settle Up", exact: true })).toBeVisible();
        await expect(page.getByRole("status", { name: "Loading settlements", exact: true })).toHaveCount(0);
        releaseExpenses();
        await firstNav.getByRole("link", { name: width === 1440 ? "Navigate to Expenses" : "Expenses", exact: true }).click();
        await expect(page.getByRole("heading", { name: "No expenses yet", exact: true })).toBeVisible();
      } finally { releaseCheck(); releaseExpenses(); releaseSettlements(); }
    });
  }

  test("retains an Expense draft when fresh session and member reads arrive", async ({ page }) => {
    const fixture = bootstrap();
    const household = { householdId: "fixture-household", name: "Fixture Home", code: "000000001", leaderId: "fixture-user", createdAt: "2026-10-03T00:00:00.000Z" };
    const active = { ...fixture, data: { ...fixture.data, household: { status: "active-leader", household, page: { household, members: [] }, joinRequests: [] }, capabilities: { ...fixture.data.capabilities, expenseMutations: true } } };
    let checks = 0;
    await page.route("**/api/app/bootstrap", (route) => { checks += 1; return route.fulfill({ json: active }); });
    await page.route("**/api/app/household-members**", (route) => route.fulfill({ json: { data: [{ userId: "fixture-user", displayName: "Fixture", role: "leader", status: "active" }] } }));
    await page.route("**/api/app/cards", (route) => route.fulfill({ json: { data: { cards: [] } } }));
    await page.route("**/api/app/receipt-quota", (route) => route.fulfill({ json: { data: 0 } }));
    await page.goto("/expenses/new");
    const name = page.getByRole("textbox", { name: "Expense Name", exact: true });
    await name.fill("Unsaved Expense");
    const before = checks;
    await resume(page);
    await expect.poll(() => checks).toBe(before + 1);
    await expect(page.getByRole("status", { name: "Loading page", exact: true })).toHaveCount(0);
    await expect(name).toHaveValue("Unsaved Expense");
  });

  test("coalesces tab resume and preserves a real dirty Profile form", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/app/bootstrap", (route) => { calls += 1; return route.fulfill({ json: bootstrap() }); });
    await page.goto("/profile");
    await page.getByRole("textbox", { name: "Display Name", exact: true }).fill("Unsaved draft");
    const initial = calls;
    await resume(page);
    await expect.poll(() => calls).toBe(initial + 1);
    await expect(page.getByRole("status", { name: "Loading page", exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Display Name", exact: true })).toHaveValue("Unsaved draft");
  });

  test("recovers one transient startup failure automatically", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/app/bootstrap", (route) => route.fulfill(++calls === 1 ? { status: 503, body: "<html>busy</html>" } : { json: bootstrap() }));
    await page.goto("/profile");
    await expect(page.getByRole("textbox", { name: "Display Name", exact: true })).toHaveValue("Fixture");
    expect(calls).toBe(2);
    await expect(page.getByText("Service temporarily unavailable")).toHaveCount(0);
  });

  test("keeps a draft through a sustained outage and an online recovery", async ({ page }) => {
    let unavailable = false;
    let writes = 0;
    await page.route("**/api/app/bootstrap", (route) => route.fulfill(unavailable ? { status: 503, json: { error: "busy" } } : { json: bootstrap() }));
    await page.route("**/api/app/profile-display-name", (route) => { writes += 1; return route.fulfill({ json: { data: null } }); });
    await page.goto("/profile");
    await page.getByRole("textbox", { name: "Display Name", exact: true }).fill("Draft stays");
    unavailable = true;
    await resume(page);
    await expect(page.getByRole("button", { name: "Retry connection" })).toBeVisible();
    await page.getByRole("button", { name: "Save Display Name" }).click();
    await expect(page.getByText("Reconnect before saving. Your draft is still here.", { exact: true })).toBeVisible();
    expect(writes).toBe(0);
    await expect(page.getByRole("textbox", { name: "Display Name", exact: true })).toHaveValue("Draft stays");
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
    unavailable = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.getByRole("button", { name: "Retry connection" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Display Name", exact: true })).toHaveValue("Draft stays");
  });

  test("action expiry redirects and removes the protected draft", async ({ page }) => {
    await page.route("**/api/app/bootstrap", (route) => route.fulfill({ json: bootstrap() }));
    await page.route("**/api/app/profile-display-name", (route) => route.fulfill({ status: 401, json: { error: "Sign in to continue." } }));
    await page.goto("/profile");
    await page.getByRole("textbox", { name: "Display Name", exact: true }).fill("Expire me");
    await waitForReadySession(page);
    await page.getByRole("button", { name: "Save Display Name" }).click();
    await expect(page).toHaveURL(/\/login\?sessionExpired=1$/);
    await expect(page.getByText("Your session has expired. Please sign in again.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Display Name", exact: true })).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  });

  test("permission denial keeps the valid user signed in", async ({ page }) => {
    let checks = 0;
    await page.route("**/api/app/bootstrap", (route) => { checks += 1; return route.fulfill({ json: bootstrap() }); });
    await page.route("**/api/app/profile-display-name", (route) => route.fulfill({ status: 403, json: { error: "This action is not permitted." } }));
    await page.goto("/profile");
    await page.getByRole("textbox", { name: "Display Name", exact: true }).fill("Denied");
    await waitForReadySession(page);
    const before = checks;
    await page.getByRole("button", { name: "Save Display Name" }).click();
    await expect(page.getByText("This action is not permitted.")).toBeVisible();
    await expect.poll(() => checks).toBe(before + 1);
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole("textbox", { name: "Display Name", exact: true })).toHaveValue("Denied");
  });

  test("lost mutation response is never replayed automatically and explicit retry keeps its ID", async ({ page }) => {
    const bodies: string[] = [];
    await page.route("**/api/app/bootstrap", (route) => route.fulfill({ json: bootstrap() }));
    await page.route("**/api/app/profile-display-name", (route) => {
      bodies.push(route.request().postData() ?? "");
      return bodies.length === 1 ? route.abort("failed") : route.fulfill({ json: { data: null } });
    });
    await page.goto("/profile");
    await page.getByRole("textbox", { name: "Display Name", exact: true }).fill("Retry name");
    await waitForReadySession(page);
    await page.getByRole("button", { name: "Save Display Name" }).click();
    await expect(page.getByText("We could not confirm whether this action completed. Check the current state before retrying.")).toBeVisible();
    expect(bodies).toHaveLength(1);
    await waitForReadySession(page);
    await page.getByRole("button", { name: "Save Display Name" }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[0]).toBe(bodies[1]);
  });

  test("successful save remains successful when its following refresh fails", async ({ page }) => {
    let saved = false;
    let commands = 0;
    await page.route("**/api/app/bootstrap", (route) => route.fulfill(saved ? { status: 503, json: { error: "busy" } } : { json: bootstrap() }));
    await page.route("**/api/app/profile-display-name", (route) => { saved = true; commands += 1; return route.fulfill({ json: { data: null } }); });
    await page.goto("/profile");
    await page.getByRole("textbox", { name: "Display Name", exact: true }).fill("Saved name");
    await waitForReadySession(page);
    await page.getByRole("button", { name: "Save Display Name" }).click();
    await expect(page.getByText("Display Name updated successfully.")).toBeVisible();
    await expect(page.getByText("Your action was saved, but the view could not refresh. Retry the connection to load the current state.")).toBeVisible();
    expect(commands).toBe(1);
  });

  test("reconnection status remains accessible and responsive", async ({ page }) => {
    let unavailable = false;
    await page.route("**/api/app/bootstrap", (route) => route.fulfill(unavailable ? { status: 503, body: "busy" } : { json: bootstrap() }));
    await page.goto("/profile");
    await expect(page.getByRole("textbox", { name: "Display Name", exact: true })).toBeVisible();
    unavailable = true;
    await resume(page);
    await expect(page.getByRole("button", { name: "Retry connection" })).toBeVisible();
    for (const width of [360, 390, 430, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  test("production Profile photo and password controls reflow without losing drafts", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const unexpected: string[] = [];
    // Block every unmatched API request so this visual check cannot reach a provider.
    await page.route("**/api/**", (route) => {
      unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      return route.fulfill({ status: 404, json: { error: "Unmatched test request." } });
    });
    await page.route("**/api/app/profile-avatar**", (route) => route.fulfill({ status: 404 }));
    await page.route("**/api/app/notifications/latest", (route) => route.fulfill({ json: { data: { notifications: [], unreadCount: 0 } } }));
    const fixture = bootstrap();
    await page.route("**/api/app/bootstrap", (route) => route.fulfill({ json: { data: { ...fixture.data, capabilities: PRODUCTION_R4_CAPABILITIES } } }));
    await page.goto("/profile");
    await page.getByRole("textbox", { name: "Display Name", exact: true }).fill("Private draft");
    await page.getByLabel("Current Password", { exact: true }).fill("fixture-password");
    const visibility = page.locator('button[aria-controls="profile-current-password"]');
    // Filling a password scrolls it into view; finish positioning its adjacent control before pointer activation.
    await visibility.scrollIntoViewIfNeeded();
    await expect(visibility).toHaveAccessibleName("Show password");
    await visibility.click();
    await expect(page.getByLabel("Current Password", { exact: true })).toHaveAttribute("type", "text");
    await expect(visibility).toHaveAccessibleName("Hide password");
    await expect(visibility).toHaveCSS("translate", "none");
    await visibility.click();
    await expect(page.getByLabel("Current Password", { exact: true })).toHaveAttribute("type", "password");
    for (const width of [360, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.getByRole("button", { name: "Change Photo", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Update Password", exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Display Name", exact: true })).toHaveValue("Private draft");
      await expect(page.getByLabel("Current Password", { exact: true })).toHaveValue("fixture-password");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      if (width === 390 || width === 1440) {
        await page.evaluate(() => { if (document.activeElement?.classList.contains("skip-link")) (document.activeElement as HTMLElement).blur(); });
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        const filename = `profile-production-${width}.png`;
        await page.screenshot({ path: process.env.UI_REDESIGN_ARTIFACT_DIR && testInfo.project.name === "chromium" ? resolve(process.env.UI_REDESIGN_ARTIFACT_DIR, filename) : testInfo.outputPath(filename), fullPage: true });
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(axe.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
      }
    }
    expect(unexpected).toEqual([]);
  });

  test("U2 service-unavailable screen matches the design and Retry recovers", async ({ page }, testInfo) => {
    let unavailable = true;
    await page.route("**/api/app/bootstrap", (route) => route.fulfill(unavailable ? { status: 503, json: { error: "fixture unavailable" } } : { json: bootstrap() }));
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Service temporarily unavailable" })).toBeVisible();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const filename = `u2-service-unavailable-${width}.png`;
      await page.screenshot({ path: process.env.UI_REDESIGN_ARTIFACT_DIR && testInfo.project.name === "chromium" ? resolve(process.env.UI_REDESIGN_ARTIFACT_DIR, filename) : testInfo.outputPath(filename), fullPage: true, animations: "disabled" });
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axe.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
    }
    unavailable = false;
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Display Name", exact: true })).toHaveValue("Fixture");
  });

  test("U2 route error is sanitized, responsive, and recovers through its existing reset", async ({ page }, testInfo) => {
    await page.route("**/api/**", (route) => route.fulfill({ status: 404, json: { error: "Unmatched fixture request" } }));
    await page.route("**/api/app/notifications/latest", (route) => route.fulfill({ json: { data: { notifications: [], unreadCount: 0 } } }));
    await page.route("**/api/app/bootstrap", (route) => route.fulfill({ json: bootstrap() }));
    let invalid = true;
    await page.route("**/api/app/cards", (route) => route.fulfill({ json: { data: invalid ? null : { cards: [] } } }));
    await page.goto("/cards");
    await expect(page.getByRole("heading", { name: "Something went wrong", exact: true })).toBeVisible();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator("main")).not.toContainText("Cannot read properties");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const filename = `u2-route-error-${width}.png`;
      await page.screenshot({ path: process.env.UI_REDESIGN_ARTIFACT_DIR && testInfo.project.name === "chromium" ? resolve(process.env.UI_REDESIGN_ARTIFACT_DIR, filename) : testInfo.outputPath(filename), fullPage: true, animations: "disabled" });
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axe.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
    }
    invalid = false;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByText("No cards yet", { exact: true })).toBeVisible();
  });
});
