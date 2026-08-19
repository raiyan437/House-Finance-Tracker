import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function switchIdentity(page: Page, identity: "raiyan" | "john" | "sarah" | "alex") {
  await page.getByTestId("development-tools-trigger").click();
  await page.getByTestId(`development-identity-user-${identity}`).click();
  await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute("data-runtime-state", "ready");
}

async function cancelAlexPendingRequest(page: Page) {
  await page.getByRole("button", { name: "Cancel Request" }).click();
  await page.getByRole("button", { name: "Cancel request" }).click();
  await expect(page.getByText("You aren't part of a household yet.")).toBeVisible();
}

function collectBrowserErrors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  return () => {
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  };
}

test("guards only household-dependent routes for a Pending requester", async ({ page }) => {
  const expectNoErrors = collectBrowserErrors(page);
  await page.goto("/dashboard");
  await switchIdentity(page, "alex");

  await expect(page).toHaveURL(/\/household$/);
  await expect(page.getByRole("heading", { name: "Household" })).toBeVisible();
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  await expect(page.getByText("Raiyan House", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText(/Groceries|John|Sarah|balance|expense/i)).toHaveCount(0);

  await page.goto("/profile");
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: "Profile foundation ready" })).toBeVisible();
  await page.goto("/cards");
  await expect(page).toHaveURL(/\/cards$/);
  await expect(page.getByRole("heading", { name: "My Cards" })).toBeVisible();
  await expect(page.getByText("No cards yet")).toBeVisible();
  await page.goto("/expenses/new");
  await expect(page).toHaveURL(/\/household$/);
  expectNoErrors();
});

test("creates a household with exact manual code and persists leader state after close and reopen", async ({ context, page }) => {
  const expectNoErrors = collectBrowserErrors(page);
  await page.goto("/household");
  await switchIdentity(page, "alex");
  await cancelAlexPendingRequest(page);

  await page.getByRole("link", { name: /Create a Household/ }).click();
  await page.getByRole("button", { name: "Generate Code" }).click();
  await expect(page.getByLabel("House Code*")).toHaveValue(/^[0-9]{9}$/);
  await page.getByLabel("House Name*").fill("  Alex Household  ");
  await page.getByLabel("House Code*").fill("000000222");
  await page.getByRole("button", { name: "Create Household" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("aside").getByText("Alex", { exact: true })).toBeVisible();
  await expect(page.locator("aside").getByText("Leader", { exact: true })).toBeVisible();
  const persisted = await page.evaluate(async () => {
    const request = indexedDB.open("house-finance-tracker-local");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction(["households", "memberships"], "readonly");
    const householdsRequest = transaction.objectStore("households").getAll();
    const membershipsRequest = transaction.objectStore("memberships").getAll();
    const [households, memberships] = await Promise.all([
      new Promise<unknown[]>((resolve, reject) => { householdsRequest.onsuccess = () => resolve(householdsRequest.result); householdsRequest.onerror = () => reject(householdsRequest.error); }),
      new Promise<unknown[]>((resolve, reject) => { membershipsRequest.onsuccess = () => resolve(membershipsRequest.result); membershipsRequest.onerror = () => reject(membershipsRequest.error); }),
    ]);
    database.close();
    return { households, memberships };
  });
  expect(JSON.stringify(persisted.households)).toContain('"name":"Alex Household"');
  expect(JSON.stringify(persisted.households)).toContain('"code":"000000222"');
  expect(JSON.stringify(persisted.memberships)).toContain('"userId":"user-alex"');
  expect(JSON.stringify(persisted.memberships)).toContain('"role":"leader"');

  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await page.close();
  const reopened = await context.newPage();
  const expectNoReopenErrors = collectBrowserErrors(reopened);
  await reopened.goto("/dashboard");
  await expect(reopened.locator("aside").getByText("Alex", { exact: true })).toBeVisible();
  await expect(reopened.locator("aside").getByText("Leader", { exact: true })).toBeVisible();
  expectNoErrors();
  expectNoReopenErrors();
});

test("validates lookup, exposes only minimal identity, sends a request, and persists Pending state", async ({ page }) => {
  const expectNoErrors = collectBrowserErrors(page);
  await page.goto("/household");
  await switchIdentity(page, "alex");
  await cancelAlexPendingRequest(page);
  await page.getByRole("link", { name: /Join a Household/ }).click();

  await page.getByLabel("House Code*").fill("12");
  await page.getByRole("button", { name: "Find Household" }).click();
  await expect(page.getByText("Enter exactly 9 digits.")).toBeVisible();
  await page.getByLabel("House Code*").fill("999999999");
  await page.getByRole("button", { name: "Find Household" }).click();
  await expect(page.getByText("No household was found for that code.")).toBeVisible();

  await page.getByLabel("House Code*").fill("012345678");
  await page.getByRole("button", { name: "Find Household" }).click();
  await expect(page.getByText("Household found")).toBeVisible();
  await expect(page.getByText("Raiyan House", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText(/John|Sarah|Groceries|balance|settlement|receipt|card/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Send Join Request" }).click();
  await expect(page).toHaveURL(/\/household$/);
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  expectNoErrors();
});

test("leader accepts atomically and the requester reconstructs active membership", async ({ page }) => {
  const expectNoErrors = collectBrowserErrors(page);
  await page.goto("/household");
  await expect(page.getByRole("list", { name: "Pending join requests" })).toContainText("Alex");
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("alertdialog", { name: "Accept Alex into Raiyan House?" })).toBeVisible();
  await page.getByRole("button", { name: "Accept request" }).click();
  await expect(page.getByText("No Pending join requests.")).toBeVisible();

  await switchIdentity(page, "alex");
  await expect(page.locator("aside").getByText("Member", { exact: true })).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("aside").getByText("Alex", { exact: true })).toBeVisible();
  expectNoErrors();
});

test("leader rejection returns the requester to normal onboarding while retaining history", async ({ page }) => {
  await page.goto("/household");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByRole("alertdialog", { name: "Reject Alex's join request?" })).toBeVisible();
  await page.getByRole("button", { name: "Reject request" }).click();
  await expect(page.getByText("No Pending join requests.")).toBeVisible();
  await switchIdentity(page, "alex");
  await expect(page.getByText("You aren't part of a household yet.")).toBeVisible();

  const status = await page.evaluate(async () => {
    const request = indexedDB.open("house-finance-tracker-local");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = database.transaction("joinRequests", "readonly").objectStore("joinRequests").get("join-alex-main");
    const record = await new Promise<Record<string, unknown>>((resolve, reject) => { read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error); });
    database.close();
    return record.status;
  });
  expect(status).toBe("rejected");
});

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test(`keeps ${viewport.name} onboarding accessible and free of horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/household");
    await switchIdentity(page, "alex");
    await expect(page.getByRole("heading", { name: "Household" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    const results = await new AxeBuilder({ page }).disableRules(["landmark-unique"]).analyze();
    expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);

    const cancel = page.getByRole("button", { name: "Cancel Request" });
    await cancel.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog", { name: "Cancel this join request?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(cancel).toBeFocused();
  });
}
