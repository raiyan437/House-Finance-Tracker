import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test("Dashboard notification bell is keyboard accessible and navigates to retained history", async ({ page }) => {
  await page.goto("/dashboard");
  const bell = page.getByRole("button", { name: /^Notifications/u });
  await expect(bell).toBeVisible();
  await expect(bell).toHaveClass(/size-11/);
  await bell.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: /New expense/u })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Household membership changed/u })).toBeVisible();
  const markAll = page.getByRole("button", { name: "Mark all as read", exact: true });
  await expect(markAll).toBeVisible();
  await markAll.click();
  await expect(page.getByRole("button", { name: "Mark all as read", exact: true })).toHaveCount(0);
  await expect(page.locator('button[aria-label="Notifications"]')).toBeVisible();
  const seeMore = page.getByRole("menuitem", { name: "See more", exact: true });
  await expect(seeMore).toBeVisible();
  await seeMore.click();
  await expect(page).toHaveURL(/\/notifications$/u);
  await expect(page.getByRole("heading", { name: "Notifications", exact: true })).toBeVisible();
});

test("Notifications page marks every retained unread row, not only the loaded page", async ({ page }) => {
  await page.goto("/notifications");
  const markAll = page.getByRole("button", { name: "Mark all as read", exact: true });
  await expect(markAll).toBeVisible();
  await markAll.click();
  await expect(page.getByRole("button", { name: "Mark all as read", exact: true })).toHaveCount(0);
  await expect(page.getByText("New expense", { exact: true })).toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 1024 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 430, height: 932 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]) {
  test(`notification bell and page fit at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/dashboard");
    const bell = page.getByRole("button", { name: /^Notifications/u });
    await bell.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press("Escape");
    await page.goto("/notifications");
    expect(await page.evaluate(() => ({ document: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth }))).toEqual({ document: 0, body: 0 });
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  });
}
