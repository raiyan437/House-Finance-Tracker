import { ApplicationError } from "@/application/errors/application-error";
import { deleteDB, openDB, unwrap, type IDBPDatabase } from "idb";
import type { HouseFinanceDatabase } from "./records";
import {
  migrateCardRecordV1ToV2,
  migrateExpenseRecordToV3,
  migratePrivateCardRecordV1ToV2,
  migrateReceiptRecordV1ToV2,
} from "./mappers";

export const LOCAL_DATABASE_NAME = "house-finance-tracker-local";
export const LOCAL_DATABASE_VERSION = 6;

export type DatabaseSource = IDBPDatabase<HouseFinanceDatabase> | Promise<IDBPDatabase<HouseFinanceDatabase>>;

function sanitizedMigrationError(error: unknown, store: string): ApplicationError {
  if (error instanceof ApplicationError) {
    return new ApplicationError(error.code, error.message, { store });
  }
  return new ApplicationError(
    "PERSISTENCE_FAILURE",
    "The local database migration could not be completed.",
    { store },
  );
}

function migrateStore(
  transaction: IDBTransaction,
  store: "expenses" | "cards" | "expenseCardPrivateDetails" | "receiptMetadata",
  transform: (value: unknown) => unknown,
  onError: (error: ApplicationError) => void,
): void {
  const request = transaction.objectStore(store).openCursor();
  request.onerror = () => {
    onError(new ApplicationError(
      "PERSISTENCE_FAILURE",
      "The local database migration could not be completed.",
      { store },
    ));
  };
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    try {
      const updateRequest = cursor.update(transform(cursor.value));
      updateRequest.onerror = () => {
        onError(new ApplicationError(
          "PERSISTENCE_FAILURE",
          "The local database migration could not be completed.",
          { store },
        ));
      };
      updateRequest.onsuccess = () => cursor.continue();
    } catch (error) {
      onError(sanitizedMigrationError(error, store));
    }
  };
}

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

  const expenseComments = database.createObjectStore("expenseComments", { keyPath: "id" });
  expenseComments.createIndex("expenseCreatedAtId", ["expenseId", "createdAt", "id"]);
  expenseComments.createIndex("householdId", "householdId");

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
  receiptMetadata.createIndex("contentStatusCreatedAt", ["contentStatus", "createdAt"]);
  receiptMetadata.createIndex("contentStatus", "contentStatus");
  receiptMetadata.createIndex("expenseContentStatus", ["expenseId", "contentStatus"]);
  receiptMetadata.createIndex("uploaderContentStatus", ["createdByUserId", "contentStatus"]);

  database.createObjectStore("receiptBlobs", { keyPath: "receiptId" });

  const audits = database.createObjectStore("auditEvents", { keyPath: "id" });
  audits.createIndex("householdId", "householdId");
  database.createObjectStore("developmentSession", { keyPath: "key" });
  const commandOutcomes = database.createObjectStore("commandOutcomes", { keyPath: "key" });
  commandOutcomes.createIndex("actorId", "actorId");
}

export async function openLocalDatabase(
  name = LOCAL_DATABASE_NAME,
): Promise<IDBPDatabase<HouseFinanceDatabase>> {
  let migrationError: ApplicationError | undefined;
  let rejectBlocked: ((reason: ApplicationError) => void) | undefined;
  const blocked = new Promise<never>((_resolve, reject) => {
    rejectBlocked = reject;
  });
  const opening = openDB<HouseFinanceDatabase>(name, LOCAL_DATABASE_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) createSchemaV1(database);
      const nativeTransaction = unwrap(transaction);
      const failMigration = (error: ApplicationError) => {
        if (!migrationError) migrationError = error;
        void transaction.done.catch(() => undefined);
        try {
          nativeTransaction.abort();
        } catch {
          // The first migration failure may already have aborted the transaction.
        }
      };
      if (
        oldVersion >= 1 && oldVersion < 5
        && database.objectStoreNames.contains("expenses")
      ) {
        migrateStore(
          nativeTransaction,
          "expenses",
          (value) => migrateExpenseRecordToV3(value),
          failMigration,
        );
      }
      if (oldVersion >= 1 && oldVersion < 3) {
        if (database.objectStoreNames.contains("cards")) {
          migrateStore(
            nativeTransaction,
            "cards",
            migrateCardRecordV1ToV2,
            failMigration,
          );
        }
        if (database.objectStoreNames.contains("expenseCardPrivateDetails")) {
          migrateStore(
            nativeTransaction,
            "expenseCardPrivateDetails",
            migratePrivateCardRecordV1ToV2,
            failMigration,
          );
        }
      }
      if (
        oldVersion >= 1
        && oldVersion < 4
        && database.objectStoreNames.contains("receiptMetadata")
      ) {
        const receiptStore = transaction.objectStore("receiptMetadata");
        if (!receiptStore.indexNames.contains("contentStatusCreatedAt")) {
          receiptStore.createIndex("contentStatusCreatedAt", ["contentStatus", "createdAt"]);
        }
        migrateStore(
          nativeTransaction,
          "receiptMetadata",
          migrateReceiptRecordV1ToV2,
          failMigration,
        );
      }
      if (oldVersion >= 1 && oldVersion < 5) {
        if (!database.objectStoreNames.contains("commandOutcomes")) {
          const outcomes = database.createObjectStore("commandOutcomes", { keyPath: "key" });
          outcomes.createIndex("actorId", "actorId");
        }
        if (database.objectStoreNames.contains("receiptMetadata")) {
          const receiptStore = transaction.objectStore("receiptMetadata");
          if (!receiptStore.indexNames.contains("contentStatus")) receiptStore.createIndex("contentStatus", "contentStatus");
          if (!receiptStore.indexNames.contains("expenseContentStatus")) receiptStore.createIndex("expenseContentStatus", ["expenseId", "contentStatus"]);
          if (!receiptStore.indexNames.contains("uploaderContentStatus")) receiptStore.createIndex("uploaderContentStatus", ["createdByUserId", "contentStatus"]);
        }
      }
      if (oldVersion >= 1 && oldVersion < 6 && !database.objectStoreNames.contains("expenseComments")) {
        const comments = database.createObjectStore("expenseComments", { keyPath: "id" });
        comments.createIndex("expenseCreatedAtId", ["expenseId", "createdAt", "id"]);
        comments.createIndex("householdId", "householdId");
      }
    },
    blocked() {
      rejectBlocked?.(new ApplicationError("DATABASE_VERSION_BLOCKED", "IndexedDB upgrade is blocked by another open connection."));
    },
    blocking(_currentVersion, _blockedVersion, event) {
      const database = (event.target as IDBDatabase | null);
      database?.close();
    },
  }).catch((error: unknown) => {
    if (migrationError) throw migrationError;
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
