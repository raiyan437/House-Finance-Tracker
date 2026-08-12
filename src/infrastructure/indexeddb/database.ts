import { ApplicationError } from "@/application/errors/application-error";
import { deleteDB, openDB, type IDBPDatabase } from "idb";
import type { HouseFinanceDatabase } from "./records";

export const LOCAL_DATABASE_NAME = "house-finance-tracker-local";
export const LOCAL_DATABASE_VERSION = 1;

function createSchemaV1(database: IDBPDatabase<HouseFinanceDatabase>): void {
  database.createObjectStore("appMeta", { keyPath: "key" });

  const profiles = database.createObjectStore("userProfiles", { keyPath: "id" });
  profiles.createIndex("emailKey", "emailKey", { unique: true });

  const households = database.createObjectStore("households", { keyPath: "id" });
  households.createIndex("code", "code", { unique: true });

  const memberships = database.createObjectStore("memberships", { keyPath: "key" });
  memberships.createIndex("householdId", "householdId");
  memberships.createIndex("activeMembershipUserKey", "activeMembershipUserKey", { unique: true });

  const joinRequests = database.createObjectStore("joinRequests", { keyPath: "id" });
  joinRequests.createIndex("householdId", "householdId");
  joinRequests.createIndex("pendingJoinUserKey", "pendingJoinUserKey", { unique: true });

  const expenses = database.createObjectStore("expenses", { keyPath: "id" });
  expenses.createIndex("householdId", "householdId");
  expenses.createIndex("creatorId", "creatorId");
  expenses.createIndex("payerId", "payerId");

  const privateCards = database.createObjectStore("expenseCardPrivateDetails", { keyPath: "expenseId" });
  privateCards.createIndex("ownerId", "ownerId");
  privateCards.createIndex("cardId", "cardId");

  const settlements = database.createObjectStore("settlements", { keyPath: "id" });
  settlements.createIndex("householdId", "householdId");
  settlements.createIndex("pendingSettlementPairKey", "pendingSettlementPairKey", { unique: true });

  const cards = database.createObjectStore("cards", { keyPath: "id" });
  cards.createIndex("ownerId", "ownerId");

  const receiptMetadata = database.createObjectStore("receiptMetadata", { keyPath: "id" });
  receiptMetadata.createIndex("expenseId", "expenseId");
  receiptMetadata.createIndex("householdId", "householdId");

  database.createObjectStore("receiptBlobs", { keyPath: "receiptId" });

  const audits = database.createObjectStore("auditEvents", { keyPath: "id" });
  audits.createIndex("householdId", "householdId");
  database.createObjectStore("developmentSession", { keyPath: "key" });
}

export async function openLocalDatabase(
  name = LOCAL_DATABASE_NAME,
): Promise<IDBPDatabase<HouseFinanceDatabase>> {
  let rejectBlocked: ((reason: ApplicationError) => void) | undefined;
  const blocked = new Promise<never>((_resolve, reject) => {
    rejectBlocked = reject;
  });
  const opening = openDB<HouseFinanceDatabase>(name, LOCAL_DATABASE_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) createSchemaV1(database);
    },
    blocked() {
      rejectBlocked?.(new ApplicationError("DATABASE_VERSION_BLOCKED", "IndexedDB upgrade is blocked by another open connection."));
    },
    blocking(_currentVersion, _blockedVersion, event) {
      const database = (event.target as IDBDatabase | null);
      database?.close();
    },
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "VersionError") {
      throw new ApplicationError("UNSUPPORTED_DATABASE_VERSION", "The local database was created by a newer unsupported schema version.");
    }
    throw new ApplicationError("PERSISTENCE_FAILURE", "The local database could not be opened.");
  });
  return Promise.race([opening, blocked]);
}

export async function deleteLocalDatabase(name = LOCAL_DATABASE_NAME): Promise<void> {
  let rejectBlocked: ((reason: ApplicationError) => void) | undefined;
  const blocked = new Promise<never>((_resolve, reject) => {
    rejectBlocked = reject;
  });
  const deleting = deleteDB(name, {
    blocked() {
      rejectBlocked?.(new ApplicationError("DATABASE_RESET_BLOCKED", "Database reset is blocked by another open connection."));
    },
  });
  await Promise.race([deleting, blocked]);
}
