import { expect, test as base, type Page } from "@playwright/test";
import { EMPTY_LOCAL_DATABASE_REVISION, deterministicSeedData } from "../../src/infrastructure/indexeddb/seed";
import {
  toAuditRecord,
  toCardRecord,
  toExpenseRecord,
  toHouseholdRecord,
  toJoinRequestRecord,
  toMembershipRecord,
  toPrivateCardRecord,
  toProfileRecord,
  toReceiptRecord,
  toSettlementRecord,
} from "../../src/infrastructure/indexeddb/mappers";

const DATABASE_NAME = "house-finance-tracker-local";
const DATABASE_VERSION = 5;
const STORES = [
  "appMeta",
  "userProfiles",
  "households",
  "memberships",
  "joinRequests",
  "expenses",
  "expenseCardPrivateDetails",
  "settlements",
  "cards",
  "receiptMetadata",
  "receiptBlobs",
  "auditEvents",
  "developmentSession",
  "commandOutcomes",
] as const;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

function browserFixtureRecords(includeReceipt: boolean) {
  const seed = deterministicSeedData();
  return {
    appMeta: { key: "seedRevision", value: EMPTY_LOCAL_DATABASE_REVISION },
    userProfiles: seed.profiles.map(toProfileRecord),
    households: [toHouseholdRecord(seed.household)],
    memberships: seed.memberships.map(toMembershipRecord),
    joinRequests: [toJoinRequestRecord(seed.joinRequest)],
    expenses: seed.expenses.map(toExpenseRecord),
    expenseCardPrivateDetails: [toPrivateCardRecord(seed.privateCard)],
    settlements: [toSettlementRecord(seed.settlement)],
    cards: seed.cards.map(toCardRecord),
    receiptMetadata: includeReceipt ? [toReceiptRecord(seed.receipt)] : [],
    receiptBlobs: includeReceipt ? [{
      receiptId: seed.receipt.receiptId,
      bytes: Array.from(seed.receiptBytes),
      mimeType: seed.receipt.mimeType,
    }] : [],
    auditEvents: seed.audits.map(toAuditRecord),
    developmentSession: [{ key: "current", currentUserId: "user-raiyan" }],
  };
}

async function seedBrowserDatabase(page: Page): Promise<void> {
  const browserName = page.context().browser()?.browserType().name();
  const records = browserFixtureRecords(browserName !== "webkit");
  await page.evaluate(async ({ databaseName, databaseVersion, stores, records }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onerror = () => reject(request.error ?? new Error("Could not open the Playwright fixture database."));
      request.onupgradeneeded = () => reject(new Error("The application did not create the expected IndexedDB schema."));
      request.onsuccess = () => {
        const database = request.result;
        let transaction: IDBTransaction;
        try {
          transaction = database.transaction(stores, "readwrite");
        } catch (error) {
          database.close();
          reject(error);
          return;
        }

        let requestFailure: string | undefined;
        const put = (storeName: string, value: unknown, label: string) => {
          const request = transaction.objectStore(storeName).put(value);
          request.onerror = () => {
            const error = request.error;
            requestFailure = `${label}: ${error?.name ?? "UnknownError"}: ${error?.message ?? "unknown request error"}`;
          };
        };

        for (const store of stores) {
          transaction.objectStore(store).clear();
        }
        put("appMeta", records.appMeta, "appMeta");
        for (const value of records.userProfiles) put("userProfiles", value, "userProfiles");
        for (const value of records.households) put("households", value, "households");
        for (const value of records.memberships) put("memberships", value, "memberships");
        for (const value of records.joinRequests) put("joinRequests", value, "joinRequests");
        for (const value of records.expenses) put("expenses", value, "expenses");
        for (const value of records.expenseCardPrivateDetails) put("expenseCardPrivateDetails", value, "expenseCardPrivateDetails");
        for (const value of records.settlements) put("settlements", value, "settlements");
        for (const value of records.cards) put("cards", value, "cards");
        for (const value of records.receiptMetadata) put("receiptMetadata", value, "receiptMetadata");
        for (const value of records.receiptBlobs) {
          put("receiptBlobs", {
            receiptId: value.receiptId,
            blob: new Blob([new Uint8Array(value.bytes)], { type: value.mimeType }),
          }, "receiptBlobs");
        }
        for (const value of records.auditEvents) put("auditEvents", value, "auditEvents");
        for (const value of records.developmentSession) put("developmentSession", value, "developmentSession");

        transaction.onerror = () => {
          const error = transaction.error;
          database.close();
          reject(new Error(`Could not seed the Playwright fixture database: ${requestFailure ?? `${error?.name ?? "UnknownError"}: ${error?.message ?? "unknown transaction error"}`}`));
        };
        transaction.onabort = () => {
          const error = transaction.error;
          database.close();
          reject(new Error(`The Playwright fixture database transaction was aborted: ${requestFailure ?? `${error?.name ?? "UnknownError"}: ${error?.message ?? "unknown transaction error"}`}`));
        };
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
      };
    });
  }, { databaseName: DATABASE_NAME, databaseVersion: DATABASE_VERSION, stores: STORES, records });
}

const test = base.extend({
  page: async ({ page }, applyFixture) => {
    await page.goto("/");
    await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute("data-runtime-state", "ready");
    await seedBrowserDatabase(page);
    try {
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    } catch (error) {
      if (!String(error).includes("NS_BINDING_ABORTED")) throw error;
    }
    await expect(page.locator('[data-slot="app-shell"]')).toHaveAttribute("data-runtime-state", "ready", { timeout: 15_000 });
    await applyFixture(page);
  },
});

async function selectExpenseDate(page: Page, value: string): Promise<void> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new Error(`Invalid test Expense Date: ${value}`);
  const targetYear = Number(match[1]);
  const targetMonth = Number(match[2]);
  const targetDay = Number(match[3]);
  const targetLabel = `${MONTH_NAMES[targetMonth - 1]} ${targetYear}`;

  await page.locator('[data-slot="date-picker-trigger"]').click();
  const calendar = page.locator("table[aria-label]");
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const currentLabel = await calendar.getAttribute("aria-label");
    if (currentLabel === targetLabel) break;
    const currentMatch = /^(\w+) (\d{4})$/u.exec(currentLabel ?? "");
    if (!currentMatch) throw new Error(`Could not read open calendar month: ${currentLabel}`);
    const currentMonth = MONTH_NAMES.indexOf(currentMatch[1] as typeof MONTH_NAMES[number]) + 1;
    const currentYear = Number(currentMatch[2]);
    const currentSerial = currentYear * 12 + currentMonth;
    const targetSerial = targetYear * 12 + targetMonth;
    await page.getByRole("button", { name: targetSerial < currentSerial ? "Previous month" : "Next month" }).click();
  }
  await expect(calendar).toHaveAttribute("aria-label", targetLabel);
  await page.getByRole("button", { name: new RegExp(`^${targetDay} ${targetLabel}(?:,|$)`, "u") }).click();
}

export { expect, selectExpenseDate, test };
export type { Page };
