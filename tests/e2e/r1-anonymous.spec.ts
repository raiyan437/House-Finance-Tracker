import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * R1 anonymous live probes: these run without credentials against the real
 * appwrite-composition server. Authenticated first-login coverage stays in
 * the opt-in auth-live.spec.ts.
 */

test.describe("R1 anonymous production surface", () => {
  async function diagnostics(context: BrowserContext, page: Page): Promise<void> {
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      // Expected anonymous auth probes surface as browser resource-load 401s.
      if (/Failed to load resource.*40[13]/.test(message.text())) return;
      problems.push(message.text());
    });
    context.on("close", () => {
      expect(problems, `unexpected console/page errors: ${problems.join(" | ")}`).toEqual([]);
    });
  }

  test("anonymous protected-route access redirects to the real login page", async ({ page }) => {
    await diagnostics(page.context(), page);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("renders the frozen login experience with zero serious/critical Axe findings", async ({ page }) => {
    await diagnostics(page.context(), page);
    await page.goto("/login");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  });

  test("keeps registration disabled and leaves no local financial storage", async ({ page }) => {
    await diagnostics(page.context(), page);
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Accounts are provided by the administrator" })).toBeVisible();
    await expect(page.locator('input[type="email"], input[type="password"]')).toHaveCount(0);
    const databases = await page.evaluate(() => indexedDB.databases().then((entries) => entries.map((entry) => entry.name)));
    expect(databases.some((name) => typeof name === "string" && name.toLowerCase().includes("finance"))).toBe(false);
  });
});
