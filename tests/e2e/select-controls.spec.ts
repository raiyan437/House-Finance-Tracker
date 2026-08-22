import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

test("open Select controls keep focus in the interaction and return it on close", async ({ page }) => {
  await page.goto("/expenses");
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute(
    "data-runtime-state",
    "ready",
  );

  const paymentSelect = page.getByRole("combobox", { name: "Payment Method" });
  await paymentSelect.focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("listbox")).toBeVisible();

  const focusState = await page.evaluate(() => {
    const activeElement = document.activeElement;
    return {
      role: activeElement?.getAttribute("role"),
      insideHiddenRegion: Boolean(activeElement?.closest('[aria-hidden="true"]')),
    };
  });
  expect(["listbox", "option"]).toContain(focusState.role);
  expect(focusState.insideHiddenRegion).toBe(false);

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Cash" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("option", { name: "All Payment Methods" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Cash" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(paymentSelect).toContainText("Cash");

  await paymentSelect.click();
  await page.keyboard.press("Escape");
  await expect(paymentSelect).toBeFocused();

  // Radix Select intentionally portals the listbox and hides the underlying
  // application region while open. The open-state contract above verifies
  // focus and keyboard semantics; Axe runs against the stable closed state.
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
});
