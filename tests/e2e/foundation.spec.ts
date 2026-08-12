import { expect, test } from "@playwright/test";

test("renders the Phase 1 foundation", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("body")).not.toBeEmpty();
  await expect(
    page.locator(
      "[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "House Finance Tracker" }),
  ).toBeVisible();
  await expect(page.getByText("Phase 1")).toBeVisible();
  await expect(
    page.getByText(/product features and backend integration have not started/i),
  ).toBeVisible();
});
