import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("Signup is responsive, accessible, canonical, and has independent password toggles", async ({ page }) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") problems.push(message.text()); });

  for (const viewport of [
    { width: 1440, height: 1024 },
    { width: 1024, height: 900 },
    { width: 768, height: 900 },
    { width: 430, height: 932 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "Create Account" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
    await expect(page.getByLabel("Confirm Password")).toHaveAttribute("autocomplete", "new-password");
    const toggles = page.getByRole("button", { name: "Show password" });
    await expect(toggles).toHaveCount(2);
    const firstToggleBox = await toggles.first().boundingBox();
    expect(firstToggleBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(firstToggleBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.getByLabel("Password", { exact: true }).fill("signup-secret");
    await toggles.first().click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("signup-secret");
    await expect(page.getByLabel("Confirm Password")).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Hide password" }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
    const action = page.getByRole("button", { name: "Create Account" });
    expect((await action.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const axeResults = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axeResults.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  }

  await page.goto("/register");
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByText("Already have an account?" )).toBeVisible();
  expect(problems).toEqual([]);
});

test("Login password toggle preserves its value and password-manager semantics across the responsive matrix", async ({ page }) => {
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
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "username");
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toHaveAttribute("autocomplete", "current-password");
    await password.fill("login-secret");
    const toggle = page.getByRole("button", { name: "Show password" });
    const toggleBox = await toggle.boundingBox();
    expect(toggleBox?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(toggleBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(password).toHaveAttribute("type", "text");
    await expect(password).toHaveValue("login-secret");
    await page.getByRole("button", { name: "Hide password" }).press("Space");
    await expect(password).toHaveAttribute("type", "password");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});
