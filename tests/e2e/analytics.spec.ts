import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

function collectBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return () => expect(errors).toEqual([]);
}

async function dashboardReady(page: Page) {
  await page.goto("/dashboard");
  await expect(page.getByText("Spending Trend", { exact: true })).toBeVisible();
}

test("Dashboard uses the selected Expense Date month while current financial state remains current", async ({ page }) => {
  const expectNoErrors = collectBrowserErrors(page);
  await dashboardReady(page);

  await expect(page.getByLabel("Select month")).toHaveValue("2026-08");
  await expect(page.getByRole("group", { name: "Active household members: Raiyan, John, Sarah" })).toBeVisible();
  const spent = page.locator('[data-slot="surface"]').filter({ hasText: /^Spent/ });
  await expect(spent).toContainText("৳450.00");
  const outstanding = page.locator('[data-slot="surface"]').filter({ hasText: /^Outstanding/ });
  await expect(outstanding).toContainText("You Owe");
  await expect(outstanding).toContainText("You Are Owed");
  await expect(outstanding).toContainText("৳200.00");
  const health = page.locator('[data-slot="surface"]').filter({ hasText: /^Settlement Health/ });
  await expect(health).toContainText("1 outstanding");
  await expect(health).toContainText("1 pending");
  await expect(page.getByRole("img", { name: /day 1 through day 31/i })).toBeVisible();
  await expect(page.getByText("Cash").first()).toBeVisible();
  const paymentMix = page.locator('[data-slot="surface"]').filter({ hasText: /^Payment Mix/ });
  await expect(paymentMix.getByText("৳300.00", { exact: true })).toBeVisible();
  await expect(paymentMix.getByText("66.67%", { exact: true })).toBeVisible();
  await expect(paymentMix.getByText("৳150.00", { exact: true })).toBeVisible();
  await expect(paymentMix.getByText("33.33%", { exact: true })).toBeVisible();
  await expect(page.locator(".recharts-line")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Internet expense details" })).toBeVisible();
  await expect(page.getByText("John Credit")).toHaveCount(0);

  const currentOutstandingText = await outstanding.textContent();
  const currentHealthText = await health.textContent();
  await page.getByLabel("Select month").fill("2026-07");
  await expect(spent).toContainText("৳0.00");
  await expect(page.getByText("No spending this month")).toBeVisible();
  await expect(page.getByText("No expenses this month")).toBeVisible();
  expect(await outstanding.textContent()).toBe(currentOutstandingText);
  expect(await health.textContent()).toBe(currentHealthText);
  expectNoErrors();
});

test("Monthly Report route validates month and exposes exact report semantics", async ({ page }) => {
  const expectNoErrors = collectBrowserErrors(page);
  await page.goto("/reports/monthly?month=2026-08");
  await expect(page.getByRole("heading", { name: "Monthly Report" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "August 2026" })).toBeVisible();
  await expect(page.getByText("No previous-month spending")).toBeVisible();
  await expect(page.getByText("Member Contributions and Expense Shares")).toBeVisible();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Share", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Claims Created")).toBeVisible();
  await expect(page.getByText("Current Outstanding", { exact: true })).toBeVisible();
  await expect(page.getByText("Current position — not a month-end balance")).toBeVisible();
  await expect(page.getByRole("img", { name: /day 1 through day 31/i })).toBeVisible();
  await expect(page.getByText("John Credit")).toHaveCount(0);

  await page.goto("/reports/monthly?month=not-a-month");
  await expect(page.getByLabel("Select Monthly Report month")).toHaveValue("2026-08");
  await page.getByLabel("Select Monthly Report month").fill("2028-02");
  await expect(page).toHaveURL(/month=2028-02/);
  await expect(page.getByRole("img", { name: /day 1 through day 29/i })).toBeVisible();
  await expect(page.getByText("No spending in either month")).toBeVisible();
  expectNoErrors();
});

test("Dashboard reconstructs after Expense creation, Settlement confirmation, and identity switching", async ({ page }) => {
  await page.goto("/expenses/new");
  await page.getByLabel("Expense Name").fill("Dashboard refresh expense");
  await page.getByLabel("Amount (BDT)").fill("10");
  await page.getByLabel("Expense Date").fill("2026-08-19");
  await page.getByRole("button", { name: "Create Expense" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard refresh expense" })).toBeVisible();
  await dashboardReady(page);
  await expect(page.locator('[data-slot="surface"]').filter({ hasText: /^Spent/ })).toContainText("৳460.00");

  await page.goto("/settlements");
  const johnClaim = page.getByRole("listitem").filter({ hasText: "John says they paid you" });
  await johnClaim.getByRole("button", { name: /confirm receipt of payment from john/i }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm Received" }).click();
  await dashboardReady(page);
  const health = page.locator('[data-slot="surface"]').filter({ hasText: /^Settlement Health/ });
  await expect(health).toContainText("0 pending");

  await page.getByTestId("development-tools-trigger").click();
  await page.getByTestId("development-identity-user-john").click();
  await expect(page.getByRole("group", { name: "Active household members: Raiyan, John, Sarah" })).toBeVisible();
  const firstBalance = page.locator('[data-slot="surface"]').filter({ hasText: /^Housemate Balances/ }).locator("li").first();
  await expect(firstBalance).toContainText("John (You)");
});

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test(`${viewport.name} analytics are responsive, reduced-motion safe, and accessible`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await dashboardReady(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const monthControl = await page.getByLabel("Select month").boundingBox();
    expect(monthControl?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.locator(".recharts-bar-rectangle").first()).toHaveCSS("transition-duration", "0.001s");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  });
}
