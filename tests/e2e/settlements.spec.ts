import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function switchIdentity(page: Page, identity: "raiyan" | "john" | "sarah") {
  await page.getByTestId("development-tools-trigger").click();
  await page.getByTestId(`development-identity-user-${identity}`).click();
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute("data-runtime-state", "ready");
}

function collectBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return () => expect(errors).toEqual([]);
}

test("cross-identity Mark Paid stays zero-effect until receiver confirmation and persists History", async ({ context, page }) => {
  const expectNoErrors = collectBrowserErrors(page);
  await page.goto("/settlements");
  await expect(page.getByRole("heading", { name: "Settlements" })).toBeVisible();
  await expect(page.getByText("You Are Owed")).toBeVisible();
  await expect(page.getByLabel("1 settlement action waiting for you")).toBeVisible();

  await switchIdentity(page, "sarah");
  await expect(page.getByText("You owe Raiyan")).toBeVisible();
  const originalOwe = await page.getByLabel("You Owe amount").textContent();
  await page.getByRole("button", { name: /settle up with raiyan/i }).click();
  await expect(page.getByRole("alertdialog")).toContainText("does not transfer money");
  await page.getByRole("button", { name: "Mark as Paid" }).click();
  await expect(page.getByText(/You marked .* as paid to Raiyan/)).toBeVisible();
  await expect(page.getByText(`Waiting for Raiyan to confirm.`)).toBeVisible();
  expect(await page.getByLabel("You Owe amount").textContent()).toBe(originalOwe);

  await switchIdentity(page, "raiyan");
  await expect(page.getByLabel("2 settlement actions waiting for you")).toBeVisible();
  const sarahClaim = page.getByRole("listitem").filter({ hasText: "Sarah says they paid you" });
  await sarahClaim.getByRole("button", { name: /confirm receipt of payment from sarah/i }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Did you receive this payment?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm Received" }).click();
  await expect(page.locator('p[role="status"][aria-live="polite"]'))
    .toHaveText("Payment confirmed and balances refreshed.");
  await expect(page.getByLabel("1 settlement action waiting for you")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Sarah" }).filter({ hasText: "Confirmed" })).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await page.close();
  const reopened = await context.newPage();
  const expectNoReopenErrors = collectBrowserErrors(reopened);
  await reopened.goto("/settlements");
  await expect(reopened.getByRole("row").filter({ hasText: "Sarah" }).filter({ hasText: "Confirmed" })).toBeVisible();
  expectNoErrors();
  expectNoReopenErrors();
});

test("duplicate Pending blocks Settle Up while receiver Reject and sender Cancel remain actor-specific", async ({ page }) => {
  await page.goto("/settlements");
  await switchIdentity(page, "john");
  await expect(page.getByText("You owe Raiyan")).toBeVisible();
  await expect(page.getByText("Resolve the existing Pending payment between you first.")).toBeVisible();
  await expect(page.getByRole("button", { name: /settle up with raiyan/i })).toHaveCount(0);
  await expect(page.getByText(/You marked .* as paid to Raiyan/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm Received" })).toHaveCount(0);

  await switchIdentity(page, "raiyan");
  const johnClaim = page.getByRole("listitem").filter({ hasText: "John says they paid you" });
  await johnClaim.getByRole("button", { name: "Reject" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reject Payment" }).click();
  await expect(page.getByRole("row").filter({ hasText: "John" }).filter({ hasText: "Rejected" })).toBeVisible();

  await switchIdentity(page, "john");
  await page.getByRole("button", { name: /settle up with raiyan/i }).click();
  await page.getByRole("button", { name: "Mark as Paid" }).click();
  await expect(page.getByText(/Waiting for Raiyan to confirm/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel Claim" }).click();
  await expect(page.getByRole("row").filter({ hasText: "John" }).filter({ hasText: "Cancelled" })).toBeVisible();
});

test("a reversed stale Pending warns the receiver and confirmation applies the original amount", async ({ page }) => {
  await page.goto("/settlements");
  await switchIdentity(page, "john");
  await page.goto("/expenses/new");
  await page.getByLabel("Expense Name").fill("Large shared payment");
  await page.getByLabel("Amount (BDT)").fill("900");
  await page.getByLabel("Expense Date").fill("2026-08-18");
  await page.getByRole("button", { name: "Create Expense" }).click();
  await expect(page.getByRole("heading", { name: "Large shared payment" })).toBeVisible();

  await switchIdentity(page, "raiyan");
  await page.goto("/settlements");
  const johnClaim = page.getByRole("listitem").filter({ hasText: "John says they paid you" });
  await expect(johnClaim.getByText(/now points in the other direction/i)).toBeVisible();
  await johnClaim.getByRole("button", { name: /confirm receipt of payment from john/i }).click();
  await expect(page.getByRole("alertdialog")).toContainText("original amount");
  await page.getByRole("alertdialog").getByRole("button", { name: "Confirm Received" }).click();
  await expect(page.getByText("You owe John")).toBeVisible();
  await expect(page.getByLabel("You Owe amount")).toHaveText("৳125.00");
  await expect(page.getByRole("row").filter({ hasText: "John" }).filter({ hasText: "Confirmed" })).toBeVisible();
});

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test(`keeps ${viewport.name} Settlements responsive, keyboard-operable, and accessible`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/settlements");
    await expect(page.getByRole("heading", { name: "Settlements" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

    const reject = page.getByRole("listitem").filter({ hasText: "John says they paid you" }).getByRole("button", { name: "Reject" });
    await reject.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(reject).toBeFocused();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? ""))).toEqual([]);
  });
}
