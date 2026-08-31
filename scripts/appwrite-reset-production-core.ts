import { createHash } from "node:crypto";

export const PRODUCTION_PROJECT_ID = "6a8b0d38002ea1bfa477";
export const PRODUCTION_ORIGIN = "https://house-finance-tracker.appwrite.network";
export const EXPECTED_SCHEMA_VERSION = 5;
export const RESET_CONFIRMATION = "DELETE ALL TEST DATA FOR FRESH START";

export const RESET_TABLE_ORDER = Object.freeze([
  "receipt_reservations",
  "receipt_metadata",
  "expense_card_private_details",
  "settlements",
  "expenses",
  "cards",
  "join_requests",
  "memberships",
  "households",
  "audit_events",
  "command_outcomes",
  "profiles",
  "coordination_guards",
] as const);

export type ResetTableId = typeof RESET_TABLE_ORDER[number];

export interface ResetArguments {
  readonly execute: boolean;
  readonly backupDirectory?: string;
}

export interface SanitizedAuthUser {
  readonly opaqueId: string;
  readonly classification: "approved-email-test-user" | "anonymous-test-artifact" | "unexpected-user";
  readonly hasEmail: boolean;
}

export interface AuthUserLike {
  readonly $id: string;
  readonly email?: string;
}

export interface ResetOperations {
  listStorageFileIds(): Promise<readonly string[]>;
  deleteStorageFile(fileId: string): Promise<"deleted" | "already-missing">;
  listRowIds(tableId: ResetTableId): Promise<readonly string[]>;
  deleteRow(tableId: ResetTableId, rowId: string): Promise<"deleted" | "already-missing">;
  listAuthUserIds(): Promise<readonly string[]>;
  deleteAuthUser(userId: string): Promise<"deleted" | "already-missing">;
}

export interface ResetDeletionResult {
  readonly storageFiles: { readonly deleted: number; readonly alreadyMissing: number };
  readonly tables: Readonly<Record<ResetTableId, { readonly deleted: number; readonly alreadyMissing: number }>>;
  readonly authUsers: { readonly deleted: number; readonly alreadyMissing: number };
}

function argumentValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function parseResetArguments(argv: readonly string[]): ResetArguments {
  const forbidden = ["--env-file", "--project", "--project-id", "--database", "--database-id"];
  if (forbidden.some((flag) => argv.includes(flag))) {
    throw new Error("Production reset refuses target overrides and always uses the known .env.local project.");
  }
  const yes = argv.includes("--yes");
  const confirmation = argumentValue(argv, "--confirm");
  const backupDirectory = argumentValue(argv, "--backup");
  const suppliedExecutionArgument = yes || confirmation !== undefined || backupDirectory !== undefined;
  if (!suppliedExecutionArgument) return { execute: false };
  if (!yes || confirmation !== RESET_CONFIRMATION || !backupDirectory) {
    throw new Error(`Destructive reset requires --yes --confirm "${RESET_CONFIRMATION}" --backup <verified-external-directory>.`);
  }
  return { execute: true, backupDirectory };
}

function normalizeEmail(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function opaqueUserId(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

export function classifyAuthUsers(users: readonly AuthUserLike[], approvedEmails: ReadonlySet<string>): readonly SanitizedAuthUser[] {
  return users.map((user) => {
    const email = normalizeEmail(user.email);
    return {
      opaqueId: opaqueUserId(user.$id),
      classification: email === ""
        ? "anonymous-test-artifact"
        : approvedEmails.has(email)
          ? "approved-email-test-user"
          : "unexpected-user",
      hasEmail: email !== "",
    };
  });
}

export function assertExpectedProductionTarget(input: {
  readonly endpoint: string;
  readonly projectId: string;
  readonly schemaVersion: number;
  readonly approvedEmailCount: number;
}): void {
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.host !== "sgp.cloud.appwrite.io") {
    throw new Error("Production reset refused: Appwrite endpoint is not the approved Singapore production endpoint.");
  }
  if (input.projectId !== PRODUCTION_PROJECT_ID) {
    throw new Error("Production reset refused: project ID is not the known House Finance Tracker production project.");
  }
  if (input.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
    throw new Error(`Production reset refused: schema version must remain ${EXPECTED_SCHEMA_VERSION}.`);
  }
  if (input.approvedEmailCount !== 3) {
    throw new Error("Production reset refused: the approved-email allowlist must contain exactly three entries.");
  }
}

async function drain(
  listIds: () => Promise<readonly string[]>,
  remove: (id: string) => Promise<"deleted" | "already-missing">,
): Promise<{ deleted: number; alreadyMissing: number }> {
  let deleted = 0;
  let alreadyMissing = 0;
  for (;;) {
    const ids = await listIds();
    if (ids.length === 0) return { deleted, alreadyMissing };
    for (const id of ids) {
      const result = await remove(id);
      if (result === "deleted") deleted += 1;
      else alreadyMissing += 1;
    }
  }
}

export async function deleteProductionTestData(operations: ResetOperations): Promise<ResetDeletionResult> {
  const storageFiles = await drain(
    () => operations.listStorageFileIds(),
    (fileId) => operations.deleteStorageFile(fileId),
  );
  const tables = {} as Record<ResetTableId, { deleted: number; alreadyMissing: number }>;
  for (const tableId of RESET_TABLE_ORDER) {
    tables[tableId] = await drain(
      () => operations.listRowIds(tableId),
      (rowId) => operations.deleteRow(tableId, rowId),
    );
  }
  const authUsers = await drain(
    () => operations.listAuthUserIds(),
    (userId) => operations.deleteAuthUser(userId),
  );
  return { storageFiles, tables, authUsers };
}
