import { ApplicationError } from "../errors/application-error";

export const MAX_AVAILABLE_RECEIPTS_PER_EXPENSE = 3;
export const RECEIPT_USER_QUOTA_BYTES = 50 * 1024 * 1024;
export const RECEIPT_PROJECT_BUDGET_BYTES = 1_000_000_000;
export const RECEIPT_PROJECT_WARNING_BYTES = 800_000_000;

export interface ReceiptStoragePolicy {
  readonly maxAvailablePerExpense: number;
  readonly userQuotaBytes: number;
  readonly projectBudgetBytes: number;
  readonly projectWarningBytes: number;
}

export const DEFAULT_RECEIPT_STORAGE_POLICY: ReceiptStoragePolicy = Object.freeze({
  maxAvailablePerExpense: MAX_AVAILABLE_RECEIPTS_PER_EXPENSE,
  userQuotaBytes: RECEIPT_USER_QUOTA_BYTES,
  projectBudgetBytes: RECEIPT_PROJECT_BUDGET_BYTES,
  projectWarningBytes: RECEIPT_PROJECT_WARNING_BYTES,
});

export interface ReceiptAdmissionUsage {
  readonly expenseAvailableCount: number;
  readonly uploaderAvailableBytes: number;
  readonly projectAvailableBytes: number;
  readonly expenseReservedCount?: number;
  readonly uploaderReservedBytes?: number;
  readonly projectReservedBytes?: number;
}

export interface ReceiptAdmissionResult {
  readonly projectWarningThresholdReached: boolean;
}

export function assertReceiptAdmission(
  usage: ReceiptAdmissionUsage,
  proposedBytes: number,
  policy: ReceiptStoragePolicy = DEFAULT_RECEIPT_STORAGE_POLICY,
): ReceiptAdmissionResult {
  const count = usage.expenseAvailableCount + (usage.expenseReservedCount ?? 0) + 1;
  const uploaderBytes = usage.uploaderAvailableBytes + (usage.uploaderReservedBytes ?? 0) + proposedBytes;
  const projectBytes = usage.projectAvailableBytes + (usage.projectReservedBytes ?? 0) + proposedBytes;
  if (count > policy.maxAvailablePerExpense) throw new ApplicationError("RECEIPT_COUNT_LIMIT_EXCEEDED", "An Expense can have at most three available receipts.");
  if (uploaderBytes > policy.userQuotaBytes) throw new ApplicationError("RECEIPT_USER_QUOTA_EXCEEDED", "Your available Receipt content quota has been reached.");
  if (projectBytes > policy.projectBudgetBytes) throw new ApplicationError("RECEIPT_PROJECT_CAPACITY_EXCEEDED", "Receipt storage is temporarily at capacity.");
  return Object.freeze({ projectWarningThresholdReached: projectBytes >= policy.projectWarningBytes });
}

export interface ReceiptStorageReservation {
  readonly commandKey: string;
  readonly expenseId: string;
  readonly uploaderId: string;
  readonly bytes: number;
  readonly state: "reserved" | "committed" | "released";
}
