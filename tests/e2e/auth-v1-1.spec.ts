import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("Signup is responsive, accessible, and canonical at narrow mobile widths", async ({ page }) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") problems.push(message.text()); });

  for (const viewport of [
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
