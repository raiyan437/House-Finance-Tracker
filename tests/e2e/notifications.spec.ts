import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test("Dashboard notification bell is keyboard accessible and navigates to retained history", async ({ page }) => {
  await page.goto("/dashboard");
  const bell = page.getByRole("button", { name: /^Notifications/u });
  await expect(bell).toBeVisible();
  await expect(bell).toHaveClass(/size-11/);
  await expect(page.locator("header").getByRole("button", { name: /^Notifications/u })).toHaveCount(1);
  const bellBox = await bell.boundingBox();
  const profileBox = await page.getByRole("link", { name: "Your profile", exact: true }).boundingBox();
  expect(profileBox!.x - bellBox!.x - bellBox!.width).toBe(8);
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

test("shared header notifications remain recipient-isolated across navigation and identity changes", async ({ page }) => {
  await page.goto("/profile");
  const bell = page.locator("header").getByRole("button", { name: /^Notifications/u });
  await bell.click();
  await expect(page.getByRole("menuitem", { name: /New expense/u })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("development-tools-trigger").click();
  await page.getByTestId("development-identity-user-alex").click();
  await expect(page.locator('.journey-header a[href="/profile"]')).toHaveAccessibleDescription(/Alex/);
  await bell.click();
  await expect(page.getByRole("menuitem", { name: /New expense/u })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: /Household membership changed/u })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Navigate to Cards", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My Cards" })).toBeVisible();
  await expect(bell).toHaveCount(1);
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
    const overflow = await page.evaluate(() => ({ document: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth }));
    // A reserved scrollbar gutter can make this difference negative during navigation.
    expect(overflow.document).toBeLessThanOrEqual(0);
    expect(overflow.body).toBeLessThanOrEqual(0);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  });
}
