export type ColumnKind = "string" | "bigint" | "integer" | "datetime" | "boolean" | "enum";

export interface ColumnDefinition {
  readonly key: string;
  readonly kind: ColumnKind;
  readonly size?: number;
  readonly elements?: readonly string[];
  readonly required: boolean;
  readonly default?: string | number | boolean;
}

export interface IndexDefinition {
  readonly key: string;
  readonly type: "unique" | "key";
  readonly columns: readonly string[];
}

export interface TableDefinition {
  readonly id: string;
  readonly name: string;
  readonly columns: readonly ColumnDefinition[];
  readonly indexes: readonly IndexDefinition[];
}

export const DATABASE_ID = "hft";
export const DATABASE_NAME = "House Finance Tracker";

export const BUCKET_ID = "receipts";
export const RECEIPT_MAX_FILE_BYTES = 10 * 1024 * 1024;

export const MAINTENANCE_FUNCTION_ID = "maintenance";
export const MAINTENANCE_SCHEDULE = "0 0 * * *";
export const MAINTENANCE_TIMEOUT_SECONDS = 300;
export const SCHEMA_VERSION = 1;
export const SCHEMA_METADATA_ROW_ID = "active";

function iso(key: string, required: boolean): ColumnDefinition {
  return { key, kind: "datetime", required };
}

function text(key: string, size: number, required: boolean): ColumnDefinition {
  return { key, kind: "string", size, required };
}

function enumeration(key: string, elements: readonly string[], required: boolean): ColumnDefinition {
  return { key, kind: "enum", elements, required };
}

function integer(key: string, required: boolean): ColumnDefinition {
  return { key, kind: "integer", required };
}

function bigInteger(key: string, required: boolean): ColumnDefinition {
  return { key, kind: "bigint", required };
}

const householdRef = text("householdId", 64, true);

export const TABLES: readonly TableDefinition[] = [
  {
    id: "profiles",
    name: "Profiles",
    columns: [text("displayName", 64, true), integer("version", true), iso("createdAt", true), iso("updatedAt", true)],
    indexes: [],
  },
  {
    id: "households",
    name: "Households",
    columns: [
      text("name", 64, true),
      text("code", 9, true),
      iso("deletedAt", false),
      integer("version", true),
      iso("createdAt", true),
      iso("updatedAt", true),
    ],
    indexes: [{ key: "code_unique", type: "unique", columns: ["code"] }],
  },
  {
    id: "memberships",
    name: "Memberships",
    columns: [
      householdRef,
      text("userId", 64, true),
      enumeration("role", ["leader", "member"], true),
      enumeration("status", ["active", "former"], true),
      iso("joinedAt", true),
      iso("leftAt", false),
      iso("statusChangedAt", true),
      integer("version", true),
    ],
    indexes: [
      { key: "by_household_status", type: "key", columns: ["householdId", "status"] },
      { key: "by_user_status", type: "key", columns: ["userId", "status"] },
      { key: "by_household_user", type: "unique", columns: ["householdId", "userId"] },
    ],
  },
  {
    id: "join_requests",
    name: "Join Requests",
    columns: [
      householdRef,
      text("userId", 64, true),
      enumeration("status", ["pending", "accepted", "rejected", "cancelled", "household-closed"], true),
      text("requesterDisplayName", 64, false),
      iso("createdAt", true),
      iso("resolvedAt", false),
    ],
    indexes: [
      { key: "by_household_status", type: "key", columns: ["householdId", "status"] },
      { key: "by_user_status", type: "key", columns: ["userId", "status"] },
    ],
  },
  {
    id: "expenses",
    name: "Expenses",
    columns: [
      householdRef,
      text("expenseDate", 10, true),
      bigInteger("amountPoisha", true),
      text("payerId", 64, true),
      enumeration("splitMethod", ["equal", "amount", "percentage"], true),
      text("name", 64, true),
      enumeration("paymentMethod", ["cash", "card"], true),
      text("paymentRefJson", 512, true),
      text("allocationsJson", 1024, true),
      text("percentageEntriesJson", 1024, false),
      integer("revision", true),
      text("createdBy", 64, true),
      iso("createdAt", true),
      iso("updatedAt", true),
      iso("deletedAt", false),
    ],
    indexes: [
      { key: "by_household_expense_date", type: "key", columns: ["householdId", "expenseDate"] },
      { key: "by_household_deleted", type: "key", columns: ["householdId", "deletedAt"] },
    ],
  },
  {
    id: "expense_card_private_details",
    name: "Expense Card Private Details",
    columns: [
      text("ownerId", 64, true),
      text("cardId", 64, true),
      text("snapshotJson", 2048, true),
      iso("createdAt", true),
    ],
    indexes: [{ key: "by_owner", type: "key", columns: ["ownerId"] }],
  },
  {
    id: "settlements",
    name: "Settlements",
    columns: [
      householdRef,
      text("senderId", 64, true),
      text("receiverId", 64, true),
      bigInteger("amountPoisha", true),
      bigInteger("originalAmountPoisha", true),
      enumeration("status", ["pending", "confirmed", "rejected", "cancelled"], true),
      text("pairKey", 140, true),
      text("recommendationDigest", 128, true),
      iso("resolvedAt", false),
      iso("createdAt", true),
    ],
    indexes: [
      { key: "by_household_status", type: "key", columns: ["householdId", "status"] },
      { key: "by_household_pair_status", type: "key", columns: ["householdId", "pairKey", "status"] },
    ],
  },
  {
    id: "cards",
    name: "Cards",
    columns: [
      text("ownerId", 64, true),
      text("name", 64, true),
      text("design", 32, true),
      enumeration("type", ["debit", "credit"], true),
      enumeration("status", ["active", "archived"], true),
      iso("archivedAt", false),
      integer("version", true),
      iso("createdAt", true),
      iso("updatedAt", true),
    ],
    indexes: [{ key: "by_owner_status", type: "key", columns: ["ownerId", "status"] }],
  },
  {
    id: "receipt_metadata",
    name: "Receipt Metadata",
    columns: [
      text("storageFileId", 64, true),
      text("uploaderId", 64, true),
      householdRef,
      text("expenseId", 64, true),
      enumeration("mimeType", ["image/jpeg", "image/png", "image/webp"], true),
      integer("sizeBytes", true),
      enumeration("contentState", ["available", "user-deleted", "retention-expired"], true),
      iso("contentRemovedAt", false),
      text("checksum", 64, true),
      iso("createdAt", true),
    ],
    indexes: [
      { key: "by_expense_state", type: "key", columns: ["expenseId", "contentState"] },
      { key: "retention_candidates", type: "key", columns: ["contentState", "createdAt"] },
    ],
  },
  {
    id: "audit_events",
    name: "Audit Events",
    columns: [
      householdRef,
      text("aggregateType", 32, true),
      text("aggregateId", 64, true),
      text("actorId", 64, true),
      text("action", 48, true),
      text("changedFieldsJson", 512, true),
      iso("occurredAt", true),
    ],
    indexes: [{ key: "by_household_occurred", type: "key", columns: ["householdId", "occurredAt"] }],
  },
  {
    id: "command_outcomes",
    name: "Command Outcomes",
    columns: [
      text("actorId", 64, true),
      text("commandType", 32, true),
      text("commandId", 64, true),
      text("intentDigest", 80, true),
      text("resourceId", 64, true),
      iso("completedAt", true),
    ],
    indexes: [{ key: "outcome_key_unique", type: "unique", columns: ["actorId", "commandType", "commandId"] }],
  },
  {
    id: "coordination_guards",
    name: "Coordination Guards",
    columns: [
      text("logicalKey", 160, true),
      text("ownerValue", 64, false),
      bigInteger("counter", true),
      integer("version", true),
      iso("createdAt", true),
    ],
    indexes: [{ key: "logical_key_unique", type: "unique", columns: ["logicalKey"] }],
  },
  {
    id: "receipt_reservations",
    name: "Receipt Reservations",
    columns: [
      text("uploaderId", 64, true),
      text("expenseId", 64, true),
      bigInteger("bytes", true),
      enumeration("state", ["reserved", "finalized", "released", "abandoned"], true),
      iso("expiresAt", true),
      iso("createdAt", true),
    ],
    indexes: [
      { key: "sweep_candidates", type: "key", columns: ["state", "expiresAt"] },
      { key: "by_uploader_state", type: "key", columns: ["uploaderId", "state"] },
    ],
  },
  {
    id: "schema_metadata",
    name: "Schema Metadata",
    columns: [integer("version", true), iso("appliedAt", true)],
    indexes: [],
  },
];

export interface BucketDefinition {
  readonly id: string;
  readonly name: string;
  readonly fileSecurity: boolean;
  readonly allowedExtensions: readonly string[];
  readonly maxFileSizeBytes: number;
  readonly encryption: boolean;
  readonly antivirus: boolean;
}

export const BUCKET: BucketDefinition = {
  id: BUCKET_ID,
  name: "Receipt binaries",
  fileSecurity: true,
  allowedExtensions: ["jpg", "jpeg", "png", "webp"],
  maxFileSizeBytes: RECEIPT_MAX_FILE_BYTES,
  encryption: true,
  antivirus: false,
};

export interface FunctionDefinitionSkeleton {
  readonly id: string;
  readonly name: string;
  readonly runtime: string;
  readonly execute: readonly string[];
  readonly schedule: string;
  readonly timeoutSeconds: number;
  readonly logging: boolean;
}

export const MAINTENANCE_FUNCTION: FunctionDefinitionSkeleton = {
  id: MAINTENANCE_FUNCTION_ID,
  name: "Maintenance worker",
  runtime: "node-22",
  execute: [],
  schedule: MAINTENANCE_SCHEDULE,
  timeoutSeconds: MAINTENANCE_TIMEOUT_SECONDS,
  logging: true,
};

export function tableById(id: string): TableDefinition | undefined {
  return TABLES.find((table) => table.id === id);
}
