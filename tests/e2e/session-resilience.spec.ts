import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PRODUCTION_R2_CAPABILITIES } from "../../src/application/runtime-capabilities";

// Production composition with intercepted API fixtures; no live business mutations.
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

test.describe("production session resilience", () => {
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
    await expect(page.getByText("Checking your connection. Please wait before saving.")).toHaveCount(0);
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
    await expect(page.getByText("Checking your connection. Please wait before saving.")).toHaveCount(0);
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
    await page.getByRole("button", { name: "Save Display Name" }).click();
    await expect(page.getByText("We could not confirm whether this action completed. Check the current state before retrying.")).toBeVisible();
    expect(bodies).toHaveLength(1);
    await resume(page);
    await expect(page.getByText("Checking your connection. Please wait before saving.")).toHaveCount(0);
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
});
