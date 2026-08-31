import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test("Profile Display Name validates, keyboard-submits, persists, and refreshes current projections", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/profile");
  const input = page.getByRole("textbox", { name: "Display Name" });
  await expect(input).toHaveValue("Raiyan");
  await expect(input).toHaveAttribute("maxlength", "20");

  await input.fill("   ");
  await page.getByRole("button", { name: "Save Display Name" }).click();
  await expect(page.getByText("Display Name is required.")).toBeVisible();
  await expect(input).toBeFocused();

  await input.fill("  Raiyan Current  ");
  await input.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Display Name updated successfully.");
  await expect(input).toHaveValue("Raiyan Current");

  const stored = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("house-finance-tracker-local", 5);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const profile = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const transaction = database.transaction("userProfiles", "readonly");
      const request = transaction.objectStore("userProfiles").get("user-raiyan");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as Record<string, unknown>);
    });
    database.close();
    return profile;
  });
  expect(stored).toMatchObject({
    id: "user-raiyan",
    displayName: "Raiyan Current",
    displayEmail: "raiyan@local.test",
    version: 2,
  });

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Display Name" })).toHaveValue("Raiyan Current");
  await page.goto("/household");
  await expect(page.locator("#main-content").getByText("Raiyan Current", { exact: true })).toBeVisible();
});

test("Profile layout remains aligned, equal-height, responsive, and accessible", async ({ page }) => {
  test.setTimeout(90_000);
  for (const viewport of [
    { width: 1440, height: 1024 },
    { width: 1024, height: 900 },
    { width: 768, height: 900 },
    { width: 430, height: 932 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/profile");
    const input = page.getByRole("textbox", { name: "Display Name" });
    const save = page.getByRole("button", { name: "Save Display Name" });
    await input.scrollIntoViewIfNeeded();
    const inputBox = await input.boundingBox();
    const saveBox = await save.boundingBox();
    expect(inputBox).not.toBeNull();
    expect(saveBox).not.toBeNull();
    expect(inputBox!.height).toBeGreaterThanOrEqual(44);
    expect(saveBox!.height).toBeGreaterThanOrEqual(44);
    expect(inputBox!.x).toBeGreaterThanOrEqual(0);
    expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(saveBox!.x + saveBox!.width).toBeLessThanOrEqual(viewport.width);
    if (viewport.width >= 640) {
      expect(Math.abs((inputBox!.y + inputBox!.height) - (saveBox!.y + saveBox!.height))).toBeLessThanOrEqual(1);
      expect(Math.abs(inputBox!.height - saveBox!.height)).toBeLessThanOrEqual(1);
    }
    const accountBox = await page.locator('section[aria-labelledby="profile-account-heading"]').boundingBox();
    const householdBox = await page.locator('section[aria-labelledby="profile-household-heading"]').boundingBox();
    expect(accountBox).not.toBeNull();
    expect(householdBox).not.toBeNull();
    if (viewport.width >= 1024) {
      expect(Math.abs(accountBox!.height - householdBox!.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(accountBox!.y - householdBox!.y)).toBeLessThanOrEqual(1);
    } else {
      expect(householdBox!.y).toBeGreaterThan(accountBox!.y + accountBox!.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

    if (viewport.width < 1024) {
      const more = page.getByRole("button", { name: /More/u });
      await more.click();
      await expect(page.getByRole("dialog", { name: "More" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Log Out" })).toBeVisible();
      await page.keyboard.press("Escape");
    }
  }
});
