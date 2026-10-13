import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";

async function openReadyShell(page: Page, path = "/dashboard") {
  await page.goto(path);
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute(
    "data-runtime-state",
    "ready",
  );
}

test.describe("responsive shell", () => {
  test("centers the desktop menu and header independently with aligned branding", async ({ page }, testInfo) => {
    await openReadyShell(page);
    const sidebar = page.locator("#desktop-sidebar");
    await expect(sidebar.locator('a[href="/profile"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Your profile", exact: true })).toHaveAccessibleDescription("Raiyan · Leader");
    for (const viewport of [
      { width: 1024, height: 600 },
      { width: 1280, height: 900 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      const geometry = await page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const header = rect(".journey-header");
        const nav = rect(".journey-top-nav");
        const stack = rect(".journey-rail-stack");
        const dashboard = rect('#desktop-sidebar a[href="/dashboard"]');
        const household = rect('#desktop-sidebar a[href="/household"]');
        const logout = rect('#desktop-sidebar button[aria-label="Log Out"]');
        const brand = rect(".journey-wordmark");
        const icon = rect(".journey-brand-icon svg");
        const actions = rect(".journey-header-actions");
        const dev = rect('[data-testid="development-tools-trigger"]');
        return {
          verticalError: stack.top + stack.height / 2 - window.innerHeight / 2,
          headerError: nav.left + nav.width / 2 - (header.left + header.width / 2),
          brandError: brand.left - dashboard.left,
          iconError: icon.left + icon.width / 2 - (dashboard.left + dashboard.width / 2),
          logoutGap: logout.top - household.bottom,
          logoutError: logout.left - household.left,
          brandGap: nav.left - brand.right,
          accountGap: actions.left - nav.right,
          devGap: dev.top - stack.bottom,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      for (const key of ["verticalError", "headerError", "brandError", "iconError", "logoutError"] as const) {
        expect(Math.abs(geometry[key]), `${key} at ${viewport.width}px`).toBeLessThanOrEqual(1);
      }
      expect(geometry.logoutGap).toBe(12);
      expect(geometry.brandGap).toBeGreaterThanOrEqual(8);
      expect(geometry.accountGap).toBeGreaterThanOrEqual(8);
      expect(geometry.devGap).toBeGreaterThanOrEqual(8);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      if (viewport.width === 1440) await page.screenshot({ path: testInfo.outputPath("centered-desktop.png"), animations: "disabled" });
    }
    await page.setViewportSize({ width: 1440, height: 480 });
    await sidebar.getByRole("button", { name: "Log Out" }).scrollIntoViewIfNeeded();
    await expect(sidebar.getByRole("button", { name: "Log Out" })).toBeInViewport();
    await page.getByTestId("development-tools-trigger").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("development-tools-trigger")).toBeInViewport();
  });

  test("keeps branding and account controls separate at narrow mobile widths", async ({ page }, testInfo) => {
    await openReadyShell(page);
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      const brand = await page.locator(".journey-wordmark").boundingBox();
      const actions = await page.locator(".journey-header-actions").boundingBox();
      expect(brand!.x + brand!.width + 8).toBeLessThanOrEqual(actions!.x);
      await expect(page.getByRole("navigation", { name: "Header navigation" })).toBeHidden();
      await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      if (width === 390) await page.screenshot({ path: testInfo.outputPath("mobile-header.png"), animations: "disabled" });
    }
  });

  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "large mobile", width: 700, height: 900 },
    { name: "tablet", width: 1023, height: 900 },
  ]) {
    test(`uses bottom navigation at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openReadyShell(page);

      const mobileNavigation = page.getByRole("navigation", {
        name: "Mobile navigation",
      });
      await expect(mobileNavigation).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Primary navigation" }),
      ).toBeHidden();

      const measurements = await page.evaluate(() => {
        const main = document.querySelector("main");
        const nav = document.querySelector(
          'nav[aria-label="Mobile navigation"]',
        );
        return {
          mainBottomPadding: main
            ? Number.parseFloat(getComputedStyle(main).paddingBottom)
            : 0,
          navigationHeight: nav?.getBoundingClientRect().height ?? 0,
          horizontalOverflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        };
      });

      expect(measurements.mainBottomPadding).toBeGreaterThanOrEqual(
        measurements.navigationHeight,
      );
      expect(measurements.horizontalOverflow).toBeLessThanOrEqual(1);

      for (const label of ["Dashboard", "Expenses", "Add", "Settlements"]) {
        const box = await mobileNavigation.getByRole("link", { name: label }).boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        await expect(mobileNavigation).not.toContainText(label);
      }
      const moreBox = await page.getByRole("button", { name: "More" }).boundingBox();
      expect(moreBox?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(mobileNavigation).not.toContainText("More");
    });
  }

  for (const viewport of [
    { name: "laptop", width: 1024, height: 768 },
    { name: "desktop", width: 1440, height: 900 },
  ]) {
    test(`uses the compact sidebar at ${viewport.name} width`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openReadyShell(page);

      await expect(
        page.getByRole("navigation", { name: "Primary navigation" }),
      ).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Mobile navigation" }),
      ).toBeHidden();
      await expect(
        page.getByRole("link", { name: "House Finance Tracker dashboard" }),
      ).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Log Out" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      const devButton = page.getByTestId("development-tools-trigger");
      await expect(devButton).toBeVisible();
      const devBox = await devButton.boundingBox();
      expect(devBox?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect((devBox?.x ?? 232) + (devBox?.width ?? 0)).toBeLessThanOrEqual(232);
    });
  }

  test("desktop sidebar stays compact on hover and focus with all controls accessible", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openReadyShell(page);
    const sidebar = page.locator("#desktop-sidebar");
    await sidebar.hover({ position: { x: 30, y: 20 } });
    await expect(page.getByRole("link", { name: "House Finance Tracker dashboard" })).toHaveCount(0);
    const dashboard = sidebar.getByRole("link", { name: "Dashboard", exact: true });
    await dashboard.focus();
    await expect(dashboard).toBeFocused();
    await expect(page.getByRole("button", { name: /(?:Expand|Collapse) sidebar/ })).toHaveCount(0);
    expect((await sidebar.boundingBox())?.width).toBe(72);
    await expect(page.locator('.journey-header a[href="/profile"]')).toHaveAccessibleDescription("Raiyan · Leader");
    for (const label of ["Dashboard", "Expenses", "Settlements", "Cards", "Household"]) {
      await expect(sidebar.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  });

  for (const viewport of [
    { width: 430, height: 932 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    test(`mobile More sheet exposes a non-clipped Logout at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.setViewportSize(viewport);
      await openReadyShell(page, "/cards");

      const more = page.getByRole("button", { name: "More" });
      await more.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "More" });
      await expect(dialog).toBeVisible();
      await expect(page.getByRole("link", { name: "Cards" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(dialog.getByRole("heading", { name: "DEV · Development tools" })).toBeVisible();
      const logout = dialog.getByRole("button", { name: "Log Out" });
      await expect(logout).toBeVisible();
      await expect(logout).toHaveAttribute("aria-disabled", "true");
      const logoutBox = await logout.boundingBox();
      expect(logoutBox?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(logoutBox?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((logoutBox?.x ?? viewport.width) + (logoutBox?.width ?? 1)).toBeLessThanOrEqual(viewport.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const axeResults = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(axeResults.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

      const identityButton = dialog.getByTestId("mobile-development-identity-user-raiyan");
      await identityButton.scrollIntoViewIfNeeded();
      await expect(identityButton).toBeVisible();
      expect((await identityButton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect(page.getByTestId("development-tools-trigger")).toBeHidden();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(more).toBeFocused();
      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors.filter((message) => /hydration|server rendered html/i.test(message))).toEqual([]);
    });
  }
});
