import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

const viewports = [
  { width: 1440, height: 1024 },
  { width: 1280, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 430, height: 932 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
] as const;

const routes = [
  ["/dashboard", "Dashboard"],
  ["/expenses", "Expenses"],
  ["/expenses/new", "Add Expense"],
  ["/expenses/expense-groceries", "Groceries"],
  ["/settlements", "Settlements"],
  ["/cards", "My Cards"],
  ["/household", "Household"],
  ["/reports/monthly?month=2026-08", "Monthly Report"],
  ["/profile", "Profile"],
] as const;

test("all main screens remain usable across the Phase 12 responsive matrix", async ({ page }) => {
  test.setTimeout(120_000);
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const [path, heading] of routes) {
      await page.goto(path);
      await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute("data-runtime-state", "ready");
      await expect(page.locator("main").getByRole("heading", { name: heading, exact: true })).toBeVisible();
      expect(await page.evaluate(() => ({
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
      })), `${path} at ${viewport.width}px`).toEqual({ documentOverflow: 0, bodyOverflow: 0 });
    }
  }
  expect(runtimeErrors).toEqual([]);
});

for (const viewport of [viewports[0], viewports[5]]) {
  test(`all main screens have no serious or critical Axe findings at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    for (const [path, heading] of routes) {
      await page.goto(path);
      await expect(page.locator("main").getByRole("heading", { name: heading, exact: true })).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(
        result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? "")),
        `${path} at ${viewport.width}px`,
      ).toEqual([]);
    }
  });
}
