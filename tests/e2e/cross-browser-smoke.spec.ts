import { expect, selectExpenseDate, test } from "./fixtures";

test("starts, persists an Expense, opens Household, creates a Settlement claim, and adapts the shell", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/dashboard");
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute(
    "data-runtime-state",
    "ready",
    { timeout: 15_000 },
  );
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();

  const stores = await page.evaluate(async () => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open("house-finance-tracker-local");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const names = Array.from(database.objectStoreNames);
      database.close();
      resolve(names);
    };
  }));
  expect(stores).toEqual(expect.arrayContaining([
    "households",
    "memberships",
    "expenses",
    "settlements",
    "developmentSession",
  ]));

  await page.goto("/expenses/new");
  await page.getByLabel("Expense Name").fill("Cross-browser poisha");
  await page.getByLabel("Amount (BDT)").fill("1.01");
  await selectExpenseDate(page, "2026-08-20");
  await page.getByRole("button", { name: "Create Expense" }).click();
  await expect(page.getByRole("heading", { name: "Cross-browser poisha" })).toBeVisible();
  await expect(page.getByText("৳1.01", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Cross-browser poisha" })).toBeVisible();

  await page.goto("/household");
  await expect(page.getByRole("heading", { name: "Household", exact: true })).toBeVisible();
  await expect(page.getByLabel("House Code hidden")).toBeVisible();

  await page.getByTestId("development-tools-trigger").click();
  await page.getByTestId("development-identity-user-sarah").click();
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute(
    "data-runtime-state",
    "ready",
  );
  await page.goto("/settlements");
  await expect(page.getByText("You owe Raiyan")).toBeVisible();
  await page.getByRole("button", { name: /settle up with raiyan/i }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Mark as Paid" }).click();
  await expect(page.getByText("Waiting for Raiyan to confirm.")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeHidden();
  expect(await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
