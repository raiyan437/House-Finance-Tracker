import { expect, test } from "./fixtures";

test("native IndexedDB persists the selected development identity across runtime reopen", async ({
  context,
  page,
}) => {
  await page.addInitScript(() => {
    const browserWindow = window as typeof window & { runtimeCloseCount?: number };
    browserWindow.runtimeCloseCount = 0;
    const originalClose = IDBDatabase.prototype.close;
    IDBDatabase.prototype.close = function close() {
      browserWindow.runtimeCloseCount = (browserWindow.runtimeCloseCount ?? 0) + 1;
      return originalClose.call(this);
    };
  });

  await page.goto("/dashboard");
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute(
    "data-runtime-state",
    "ready",
  );
  await expect(page.locator('a[href="/profile"]').getByText("Raiyan", { exact: true })).toBeVisible();
  await expect(page.locator('a[href="/profile"]').getByText("Leader", { exact: true })).toBeVisible();

  const databases = await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name),
  );
  expect(databases).toContain("house-finance-tracker-local");

  await page.getByTestId("development-tools-trigger").click();
  await page.getByTestId("development-identity-user-john").click();
  await expect(page.locator('a[href="/profile"]').getByText("John", { exact: true })).toBeVisible();
  await expect(page.locator('a[href="/profile"]').getByText("Member", { exact: true })).toBeVisible();

  const closeCount = await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    return (window as typeof window & { runtimeCloseCount?: number })
      .runtimeCloseCount;
  });
  expect(closeCount).toBeGreaterThan(0);
  await page.close();

  const reopenedPage = await context.newPage();
  await reopenedPage.goto("/dashboard");
  await expect(reopenedPage.locator('[data-slot="app-shell"]')).toHaveAttribute(
    "data-runtime-state",
    "ready",
  );
  await expect(
    reopenedPage.locator('a[href="/profile"]').getByText("John", { exact: true }),
  ).toBeVisible();
  await expect(
    reopenedPage.locator('a[href="/profile"]').getByText("Member", { exact: true }),
  ).toBeVisible();
});
