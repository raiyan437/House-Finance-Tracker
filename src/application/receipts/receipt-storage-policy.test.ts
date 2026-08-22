import { describe, expect, it } from "vitest";
import {
  assertReceiptAdmission,
  RECEIPT_PROJECT_BUDGET_BYTES,
  RECEIPT_PROJECT_WARNING_BYTES,
  RECEIPT_USER_QUOTA_BYTES,
} from "./receipt-storage-policy";

const usage = {
  expenseAvailableCount: 0,
  uploaderAvailableBytes: 0,
  projectAvailableBytes: 0,
};

describe("receipt storage admission", () => {
  it.each([0, 1, 2])("accepts the next receipt when %i are available", (expenseAvailableCount) => {
    expect(() => assertReceiptAdmission({ ...usage, expenseAvailableCount }, 1)).not.toThrow();
  });

  it("rejects a fourth available receipt", () => {
    expect(() => assertReceiptAdmission({ ...usage, expenseAvailableCount: 3 }, 1)).toThrowError(expect.objectContaining({ code: "RECEIPT_COUNT_LIMIT_EXCEEDED" }));
  });

  it("accepts the exact uploader quota and rejects one byte beyond it", () => {
    expect(() => assertReceiptAdmission({ ...usage, uploaderAvailableBytes: RECEIPT_USER_QUOTA_BYTES - 1 }, 1)).not.toThrow();
    expect(() => assertReceiptAdmission({ ...usage, uploaderAvailableBytes: RECEIPT_USER_QUOTA_BYTES }, 1)).toThrowError(expect.objectContaining({ code: "RECEIPT_USER_QUOTA_EXCEEDED" }));
  });

  it("includes concurrent reservations in count, uploader quota, and project capacity", () => {
    expect(() => assertReceiptAdmission({ ...usage, expenseAvailableCount: 2, expenseReservedCount: 1 }, 1)).toThrowError(expect.objectContaining({ code: "RECEIPT_COUNT_LIMIT_EXCEEDED" }));
    expect(() => assertReceiptAdmission({ ...usage, uploaderReservedBytes: RECEIPT_USER_QUOTA_BYTES }, 1)).toThrowError(expect.objectContaining({ code: "RECEIPT_USER_QUOTA_EXCEEDED" }));
    expect(() => assertReceiptAdmission({ ...usage, projectReservedBytes: RECEIPT_PROJECT_BUDGET_BYTES }, 1)).toThrowError(expect.objectContaining({ code: "RECEIPT_PROJECT_CAPACITY_EXCEEDED" }));
  });

  it("warns at 800 MB without rejecting and rejects above the 1 GB budget", () => {
    expect(assertReceiptAdmission({ ...usage, projectAvailableBytes: RECEIPT_PROJECT_WARNING_BYTES - 1 }, 1)).toEqual({ projectWarningThresholdReached: true });
    expect(() => assertReceiptAdmission({ ...usage, projectAvailableBytes: RECEIPT_PROJECT_BUDGET_BYTES - 1 }, 1)).not.toThrow();
    expect(() => assertReceiptAdmission({ ...usage, projectAvailableBytes: RECEIPT_PROJECT_BUDGET_BYTES }, 1)).toThrowError(expect.objectContaining({ code: "RECEIPT_PROJECT_CAPACITY_EXCEEDED" }));
  });
});
