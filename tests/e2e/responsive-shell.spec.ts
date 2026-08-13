import { expect, test, type Page } from "@playwright/test";

async function openReadyShell(page: Page, path = "/dashboard") {
  await page.goto(path);
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute(
    "data-runtime-state",
    "ready",
  );
}

test.describe("responsive shell", () => {
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
        const box = await page.getByRole("link", { name: label }).boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      const moreBox = await page.getByRole("button", { name: "More" }).boundingBox();
      expect(moreBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    });
  }

  for (const viewport of [
    { name: "laptop", width: 1024, height: 768 },
    { name: "desktop", width: 1440, height: 900 },
  ]) {
    test(`uses the full sidebar at ${viewport.name} width`, async ({ page }) => {
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
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Log Out" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });
  }

  test("mobile More sheet supports focus management and navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
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
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(more).toBeFocused();
  });
});
