import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "./fixtures";

async function switchIdentity(page: Page, identity: "raiyan" | "john" | "alex") {
  await page.getByTestId("development-tools-trigger").click();
  await page.getByTestId(`development-identity-user-${identity}`).click();
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute("data-runtime-state", "ready");
}

async function addCard(
  page: Page,
  name: string,
  type: "Debit" | "Credit",
  color: string,
) {
  await page.getByRole("button", { name: "Add Card" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add Card" });
  await expect(dialog.getByLabel("Card Name")).toBeFocused();
  await dialog.getByLabel("Card Name").fill(name);
  await dialog.getByRole("radio", { name: type }).click();
  await dialog.getByRole("radio", { name: color, exact: true }).click();
  await dialog.getByRole("button", { name: "Add Card" }).click();
  await expect(
    page.getByRole("list", { name: "Your active Cards" }).getByText(name.trim(), { exact: true }),
  ).toBeVisible();
}

test("creates, edits, persists, and physically deletes a private Card", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/cards");
  await expect(page.getByRole("heading", { name: "My Cards" })).toBeVisible();
  await addCard(page, "  Travel Card  ", "Credit", "Red");

  const travelMenu = page.getByRole("button", { name: /actions for travel card/i });
  await travelMenu.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Card" });
  await edit.getByLabel("Card Name").fill("Everyday Card");
  await edit.getByRole("radio", { name: "Debit" }).click();
  await edit.getByRole("radio", { name: "Black", exact: true }).click();
  await edit.getByRole("button", { name: "Save Changes" }).click();
  await expect(
    page.getByRole("list", { name: "Your active Cards" }).getByText("Everyday Card", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Your active Cards" }).getByText("Raiyan", { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("Everyday Card", { exact: true })).toBeVisible();

  const removeTrigger = page.getByRole("button", { name: /actions for everyday card/i });
  await removeTrigger.click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation.getByRole("heading", { name: "Delete Everyday Card?" })).toBeVisible();
  await expect(confirmation.getByText(/never been used by an expense/i)).toBeVisible();
  await confirmation.getByRole("button", { name: "Delete Card" }).click();
  await expect(page.getByText("Everyday Card", { exact: true })).toHaveCount(0);

  expect(browserErrors).toEqual([]);
});

test("keeps Cards owner-private across identity changes and works without Household access", async ({ page }) => {
  await page.goto("/cards");
  await expect(page.getByText("Daily Debit", { exact: true })).toBeVisible();
  await expect(page.getByText("John Credit", { exact: true })).toHaveCount(0);

  await switchIdentity(page, "john");
  await expect(page.getByText("John Credit", { exact: true })).toBeVisible();
  await expect(page.getByText("Daily Debit", { exact: true })).toHaveCount(0);

  await switchIdentity(page, "alex");
  await expect(page).toHaveURL(/\/cards$/);
  await expect(page.getByText("No cards yet")).toBeVisible();
  await addCard(page, "Alex Private", "Debit", "Blue");
  await expect(page.getByText("Alex Private", { exact: true })).toBeVisible();
  await switchIdentity(page, "raiyan");
  await expect(page.getByText("Alex Private", { exact: true })).toHaveCount(0);
});

test("Card edits and archives never rewrite the owner's historical Expense snapshot", async ({ page }) => {
  await page.goto("/cards");
  await switchIdentity(page, "john");
  await page.getByRole("button", { name: /actions for john credit/i }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Card" });
  await edit.getByLabel("Card Name").fill("Main Credit");
  await edit.getByRole("radio", { name: "Green", exact: true }).click();
  await edit.getByRole("button", { name: "Save Changes" }).click();
  await expect(
    page.getByRole("list", { name: "Your active Cards" }).getByText("Main Credit", { exact: true }),
  ).toBeVisible();

  await page.goto("/expenses/expense-internet");
  await expect(page.getByText(/John Credit.*credit.*Powder Blue/)).toBeVisible();
  await page.goto("/cards");
  await page.getByRole("button", { name: /actions for main credit/i }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  const archive = page.getByRole("alertdialog");
  await expect(archive.getByRole("heading", { name: "Archive Main Credit?" })).toBeVisible();
  await expect(archive.getByText(/historical records will remain unchanged/i)).toBeVisible();
  await archive.getByRole("button", { name: "Archive Card" }).click();
  await expect(page.getByText("Main Credit", { exact: true })).toHaveCount(0);

  await page.goto("/expenses/expense-internet");
  await expect(page.getByText(/John Credit.*credit.*Powder Blue/)).toBeVisible();
  await page.getByRole("link", { name: "Edit" }).click();
  const archivedCardSelect = page.getByRole("combobox", { name: "Your Card" });
  await expect(archivedCardSelect).toContainText("Keep John Credit (archived)");
  await archivedCardSelect.click();
  await expect(page.getByRole("option", { name: /Keep John Credit \(archived\)/ })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText(/John Credit.*credit.*Powder Blue/)).toBeVisible();
});

test("mobile Cards controls remain usable and have no serious accessibility findings", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/cards");
  const list = page.getByRole("list", { name: "Your active Cards" });
  await expect(list).toBeVisible();
  await expect.poll(() => list.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(" ").length,
  )).toBe(1);
  const add = page.getByRole("button", { name: "Add Card" });
  await expect(add).toBeVisible();
  const box = await add.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add Card" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "Red", exact: true })).toHaveAttribute("aria-checked", "true");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  )).toEqual([]);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  for (const viewport of [
    { width: 768, height: 1024, columns: 2 },
    { width: 1440, height: 900, columns: 3 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/cards");
    const responsiveList = page.getByRole("list", { name: "Your active Cards" });
    await expect(responsiveList).toBeVisible();
    await expect.poll(() => responsiveList.evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(" ").length,
    )).toBe(viewport.columns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
