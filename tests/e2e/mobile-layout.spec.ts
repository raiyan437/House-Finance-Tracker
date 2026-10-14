import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";

async function seriousFindings(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return result.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""));
}

test("phone live filters retain their query across sheets and desktop resize @critical", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/expenses?month=2026-08");
  const groceries = page.getByRole("link", { name: "Open Groceries expense details" });
  await expect(groceries).toBeVisible();
  expect((await groceries.boundingBox())!.y).toBeLessThan(600);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Filters", exact: true });
  await sheet.getByRole("combobox", { name: "Paid By", exact: true }).click();
  await page.getByRole("option", { name: "John", exact: true }).click();
  await expect(page.locator(".journey-expense-row")).toHaveCount(1);
  await sheet.getByRole("combobox", { name: "Payment Method", exact: true }).click();
  await page.getByRole("option", { name: "Card", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("link", { name: "Open Internet expense details" })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("combobox", { name: "Paid By", exact: true })).toContainText("John");
  await expect(page.getByRole("combobox", { name: "Payment Method", exact: true })).toContainText("Card");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await sheet.getByRole("button", { name: "Clear Filters", exact: true }).click();
  await expect(sheet.getByRole("combobox", { name: "Month", exact: true })).toContainText("September 2026");
  await expect(sheet.getByRole("combobox", { name: "Paid By", exact: true })).toContainText("All Members");
});

test("phone overlays and viewport changes retain the mounted percentage draft @critical", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/expenses/new");
  const name = page.getByLabel("Expense Name");
  await name.fill("Retained phone draft");
  const instance = await name.elementHandle();
  await page.getByLabel("Amount (BDT)").fill("300");
  await page.getByRole("radio", { name: "percentage", exact: true }).check();
  for (const [member, value] of [["John", "33.33"], ["Raiyan", "33.33"], ["Sarah", "33.34"]]) {
    await page.getByRole("textbox", { name: `Percentage share for ${member}`, exact: true }).fill(value);
  }
  await expect(page.getByLabel("Expense summary and actions")).toContainText("৳99.99");
  const bell = page.getByRole("button", { name: /^Notifications/ });
  await bell.click();
  await expect(page.getByRole("menuitem", { name: "Mark all as read", exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute("inert", "");
  expect(await seriousFindings(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(bell).toBeFocused();
  await expect(page.locator('[data-slot="app-shell"]')).not.toHaveAttribute("inert", "");
  await page.getByRole("button", { name: /^More(?:,|$)/ }).click();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await instance!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(name).toHaveValue("Retained phone draft");
  await expect(page.getByRole("textbox", { name: "Percentage share for Sarah", exact: true })).toHaveValue("33.34");
});

for (const width of [320, 390]) {
  test(`phone Card sheet and enabled calendar days stay reachable at ${width}px @critical`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/cards");
    await page.getByRole("button", { name: "Add Card", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add Card", exact: true });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    await page.getByLabel("Card Name").fill("Phone Card draft");
    await page.getByRole("button", { name: "Cancel", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
    expect(await seriousFindings(page)).toEqual([]);
    if (width === 390) {
      await page.setViewportSize({ width, height: 430 });
      // Dynamic viewport units settle after the browser's resize acknowledgement.
      await expect.poll(async () => {
        const resized = await dialog.boundingBox();
        return resized ? resized.y + resized.height : Infinity;
      }).toBeLessThanOrEqual(430);
      await page.getByRole("button", { name: "Cancel", exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
      await expect(page.getByLabel("Card Name")).toHaveValue("Phone Card draft");
      await page.setViewportSize({ width, height: 844 });
    }
    await page.keyboard.press("Escape");
    await page.goto("/expenses/new");
    await page.locator('[data-slot="date-picker-trigger"]').click();
    await expect(page.getByRole("button", { name: "30 August 2026", exact: true })).toBeEnabled();
    expect(await seriousFindings(page)).toEqual([]);
    await page.getByRole("button", { name: "30 August 2026", exact: true }).click();
    await expect(page.locator('[data-slot="date-picker-trigger"]')).toContainText("30 Aug 2026");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test("phone receiver confirmation preserves exact money and locks prior Expense history @critical", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settlements");
  await page.getByRole("button", { name: /Confirm receipt of payment from John/ }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("৳25.00");
  await expect(confirmation).toContainText("outside the application");
  await confirmation.getByRole("button", { name: "Confirm Received", exact: true }).click();
  await expect(page.locator('p[role="status"][aria-live="polite"]')).toHaveText("Payment confirmed and balances refreshed.");
  await page.goto("/dashboard");
  await expect(page.locator('[data-slot="surface"]').filter({ hasText: /^Outstanding/ })).toContainText("৳175.00");
  await page.goto("/expenses/expense-groceries/edit");
  await expect(page.getByLabel("Amount (BDT)")).toBeDisabled();
  await expect(page.getByLabel("Expense Name")).toBeEnabled();
});
