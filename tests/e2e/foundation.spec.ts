import { expect, test } from "./fixtures";

test("redirects to the primary destination and renders the application shell", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/");

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute(
    "data-runtime-state",
    "ready",
  );
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toHaveClass(/sr-only/);
  await expect(page.getByText("Spending Trend", { exact: true })).toBeVisible();
  await expect(page.locator("[data-nextjs-dialog], .vite-error-overlay")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
