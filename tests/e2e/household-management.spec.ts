import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function switchIdentity(
  page: Page,
  identity: "raiyan" | "john" | "sarah" | "alex",
) {
  await page.getByTestId("development-tools-trigger").click();
  await page.getByTestId(`development-identity-user-${identity}`).click();
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute(
    "data-runtime-state",
    "ready",
  );
}

async function settleSeededHousehold(page: Page) {
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute(
    "data-runtime-state",
    "ready",
  );
  await page.evaluate(async () => {
    const opening = indexedDB.open("house-finance-tracker-local");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const transaction = database.transaction(
      ["expenses", "settlements"],
      "readwrite",
    );
    const expenses = transaction.objectStore("expenses");
    const settlements = transaction.objectStore("settlements");
    const expenseRows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = expenses.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const settlementRows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = settlements.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const resolvedAt = "2026-08-19T12:00:00.000Z";
    for (const expense of expenseRows) {
      expenses.put({
        ...expense,
        updatedAt: resolvedAt,
        deletedAt: resolvedAt,
        deletedByUserId: "user-raiyan",
      });
    }
    for (const settlement of settlementRows) {
      const terminal: Record<string, unknown> = {
        ...settlement,
        status: "cancelled",
        resolvedAt,
      };
      delete terminal.pendingSettlementPairKey;
      settlements.put(terminal);
    }
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute(
    "data-runtime-state",
    "ready",
  );
}

async function storedRows(page: Page, stores: readonly string[]) {
  return page.evaluate(async (storeNames) => {
    const opening = indexedDB.open("house-finance-tracker-local");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const result: Record<string, unknown[]> = {};
    for (const storeName of storeNames) {
      const transaction = database.transaction(storeName, "readonly");
      result[storeName] = await new Promise<unknown[]>((resolve, reject) => {
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    database.close();
    return result;
  }, stores);
}

test("active Leader and Member views protect the House Code and Leader-only controls", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/household");
  await expect(page.getByLabel("House Code hidden")).toHaveText("•••••••••");
  await page.getByRole("button", { name: "Show House Code" }).click();
  await expect(page.getByLabel("House Code 012345678")).toHaveText("012345678");
  await page.getByRole("button", { name: "Copy exact House Code" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("012345678");
  await expect(page.getByText("Join requests")).toBeVisible();
  await expect(page.getByText("Danger zone")).toBeVisible();

  await switchIdentity(page, "john");
  await expect(page.getByLabel("House Code hidden")).toBeVisible();
  await expect(page.getByText("Join requests")).toHaveCount(0);
  await expect(page.getByText("Danger zone")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Manage / })).toHaveCount(0);
});

test("cross-identity transfer, Leave, and Remove reconstruct authority and route access", async ({
  page,
}) => {
  await page.goto("/household");
  await settleSeededHousehold(page);

  const johnMenu = page.getByRole("button", { name: "Manage John" });
  await johnMenu.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Transfer Leadership" }).click();
  await page.getByRole("button", { name: "Transfer Leadership" }).click();
  await expect(page.getByText("Danger zone")).toHaveCount(0);
  await expect(page.locator("aside").getByText("Member", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Leave Household" }).click();
  await page.getByRole("button", { name: "Leave Household" }).click();
  await expect(page.getByText("You aren't part of a household yet.")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/household$/);
  await page.goto("/cards");
  await expect(page.getByRole("heading", { name: "My Cards" })).toBeVisible();

  await switchIdentity(page, "john");
  await page.goto("/household");
  await expect(page.getByText("Danger zone")).toBeVisible();
  await page.getByRole("button", { name: "Manage Sarah" }).click();
  await page.getByRole("menuitem", { name: "Remove Member" }).click();
  await page.getByRole("button", { name: "Remove Member" }).click();
  await expect(page.getByRole("list", { name: "Active household members" })).not.toContainText("Sarah");

  await switchIdentity(page, "sarah");
  await expect(page.getByText("You aren't part of a household yet.")).toBeVisible();
  await page.goto("/expenses");
  await expect(page).toHaveURL(/\/household$/);
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Profile foundation ready" })).toBeVisible();
});

test("Household deletion closes Pending requests, preserves private history, and persists across reopen", async ({
  context,
  page,
}) => {
  await page.goto("/household");
  await settleSeededHousehold(page);
  const protectedStores = [
    "expenses",
    "settlements",
    "receiptMetadata",
    "receiptBlobs",
    "cards",
    "expenseCardPrivateDetails",
    "userProfiles",
  ] as const;
  const before = await storedRows(page, protectedStores);

  await page.getByRole("button", { name: "Delete Household" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Delete Raiyan House?" });
  await expect(confirmation).toContainText("Historical financial records will be preserved");
  await confirmation.getByRole("button", { name: "Delete Household" }).click();
  await expect(page.getByText("You aren't part of a household yet.")).toBeVisible();
  expect(await storedRows(page, protectedStores)).toEqual(before);

  const deletionState = await storedRows(page, ["households", "memberships", "joinRequests"]);
  expect(JSON.stringify(deletionState.households)).toContain('"deletedByUserId":"user-raiyan"');
  expect(JSON.stringify(deletionState.memberships)).not.toContain("activeMembershipUserKey");
  expect(JSON.stringify(deletionState.joinRequests)).toContain('"status":"household-closed"');

  await switchIdentity(page, "alex");
  await expect(page.getByText("You aren't part of a household yet.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Create a Household/ })).toBeVisible();
  await page.goto("/cards");
  await expect(page.getByRole("heading", { name: "My Cards" })).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/household");
  await expect(reopened.getByText("You aren't part of a household yet.")).toBeVisible();
});

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test(`keeps ${viewport.name} household management accessible without horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/household");
    await expect(page.locator("main h1").filter({ hasText: "Household" }).first()).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBe(false);
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      ),
    ).toEqual([]);
  });
}
