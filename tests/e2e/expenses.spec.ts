import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("expense list composes filters and opens accessible desktop rows", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "Expenses" })).toBeVisible();
  await expect(page.getByLabel("Month")).toHaveValue("2026-08");
  await expect(page.getByText("Groceries", { exact: true })).toBeVisible();
  await expect(page.getByText("Internet", { exact: true })).toBeVisible();

  await page.getByLabel("Search expenses by name").fill(" inter ");
  await page.getByLabel("Paid By").selectOption("user-john");
  await page.getByLabel("Payment").selectOption("card");
  await expect(page.getByText("Internet", { exact: true })).toBeVisible();
  await expect(page.getByText("Groceries", { exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Open Internet expense details" }).focus();
  await expect(page.getByRole("link", { name: "Open Internet expense details" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Internet" })).toBeVisible();
  await expect(page.getByText("Payment Method")).toBeVisible();
  await expect(page.getByText("John Credit")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("creates and reloads an exact percentage expense with a receipt", async ({ page }) => {
  await page.goto("/expenses/new");
  await expect(page.getByRole("heading", { name: "Add Expense" })).toBeVisible();
  await expect(page.getByText("You", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("radio", { name: "cash" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "You" })).toBeChecked();

  await page.getByLabel("Expense Name").fill("Percentage dinner");
  await page.getByLabel("Amount (BDT)").fill("100");
  await page.getByLabel("Expense Date").fill("2026-08-18");
  await page.getByRole("radio", { name: "percentage" }).check();
  await page.getByLabel("Percentage share for Raiyan").fill("33.34");
  await page.getByLabel("Percentage share for John").fill("33.33");
  await page.getByLabel("Percentage share for Sarah").fill("33.33");
  await expect(page.getByText("Percentages must total exactly 100%.")).toHaveCount(0);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nCEAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "dinner.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByText("dinner.png")).toBeVisible();
  await page.getByRole("button", { name: "Create Expense" }).click();

  await expect(page.getByRole("heading", { name: "Percentage dinner" })).toBeVisible();
  await expect(page.getByText("33.34%", { exact: false })).toBeVisible();
  await expect(page.getByText("dinner.png")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Percentage dinner" })).toBeVisible();
  await expect(page.getByText("33.34%", { exact: false })).toBeVisible();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});

test("mobile expense cards and the one-page form remain clear of bottom navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/expenses");
  await expect(page.getByRole("link", { name: "Open Groceries expense details" })).toBeVisible();
  await page.goto("/expenses/new");
  await expect(page.getByRole("heading", { name: "Add Expense" })).toBeVisible();
  const createButton = page.getByRole("button", { name: "Create Expense" });
  await createButton.scrollIntoViewIfNeeded();
  const [buttonBox, navigationBox] = await Promise.all([
    createButton.boundingBox(),
    page.locator('nav[aria-label="Mobile navigation"]').boundingBox(),
  ]);
  expect(buttonBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(navigationBox!.y);
});

test("leader Card editing stays opaque and normal members remain view-only", async ({ page }) => {
  await page.goto("/expenses/expense-internet");
  await expect(page.getByRole("heading", { name: "Internet" })).toBeVisible();
  await expect(page.getByText("John Credit")).toHaveCount(0);
  await page.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByText("The existing private Card association will be preserved opaquely.")).toBeVisible();
  await expect(page.getByText("John Credit")).toHaveCount(0);
  await page.getByRole("radio", { name: "cash" }).check();
  await page.getByText("Confirm changing the current Payment Method from Card to Cash.").click();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByRole("heading", { name: "Internet" })).toBeVisible();
  await expect(page.getByText("cash", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("John Credit")).toHaveCount(0);

  await page.getByTestId("development-tools-trigger").click();
  await page.getByTestId("development-identity-user-sarah").click();
  await page.goto("/expenses/expense-groceries");
  await expect(page.getByRole("heading", { name: "Groceries" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
});
