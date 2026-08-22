import { describe, expect, it } from "vitest";

import type { ReceiptMetadata } from "@/domain/records/domain-records";
import { expenseId, householdId, receiptId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import {
  calculateReceiptRetentionCutoff,
  isReceiptContentExpired,
  markReceiptContentRetentionExpired,
  markReceiptContentUserDeleted,
} from "./receipt-content-lifecycle";

const actor = userId("user-receipt-owner");
const available: ReceiptMetadata = {
  receiptId: receiptId("receipt-retention"),
  householdId: householdId("house-retention"),
  expenseId: expenseId("expense-retention"),
  createdByUserId: actor,
  mimeType: "image/png",
  originalFilename: "receipt.png",
  sizeBytes: 42,
  createdAt: isoInstant("2026-08-20T14:00:00.000Z"),
  contentStatus: "available",
};

describe("receipt content lifecycle", () => {
  it("transitions available content to explicit user deletion", () => {
    expect(markReceiptContentUserDeleted(available, isoInstant("2026-08-21T00:00:00.000Z"), actor)).toMatchObject({
      contentStatus: "user-deleted",
      contentRemovedAt: "2026-08-21T00:00:00.000Z",
      contentRemovedByUserId: actor,
    });
  });

  it("transitions available content to retention expiration without a user", () => {
    const expired = markReceiptContentRetentionExpired(available, isoInstant("2026-11-01T00:00:00.000Z"));
    expect(expired).toMatchObject({
      contentStatus: "retention-expired",
      contentRemovedAt: "2026-11-01T00:00:00.000Z",
    });
    expect(expired).not.toHaveProperty("contentRemovedByUserId");
  });

  it("rejects every transition from either terminal state", () => {
    const userDeleted = markReceiptContentUserDeleted(available, isoInstant("2026-08-21T00:00:00.000Z"), actor);
    const retentionExpired = markReceiptContentRetentionExpired(available, isoInstant("2026-11-01T00:00:00.000Z"));
    expect(() => markReceiptContentRetentionExpired(userDeleted, isoInstant("2026-11-02T00:00:00.000Z"))).toThrow(/cannot transition/i);
    expect(() => markReceiptContentUserDeleted(retentionExpired, isoInstant("2026-11-02T00:00:00.000Z"), actor)).toThrow(/cannot transition/i);
  });
});

describe("receipt retention cutoff", () => {
  it.each([
    ["January/year boundary", "2027-01-15T06:00:00.000Z", "2026-10-31T18:00:00.000Z"],
    ["February", "2027-02-15T06:00:00.000Z", "2026-11-30T18:00:00.000Z"],
    ["leap-year February", "2028-02-29T12:00:00.000Z", "2027-11-30T18:00:00.000Z"],
    ["March", "2027-03-15T06:00:00.000Z", "2026-12-31T18:00:00.000Z"],
    ["August", "2026-08-22T06:00:00.000Z", "2026-05-31T18:00:00.000Z"],
  ])("calculates the %s cutoff at Dhaka month start", (_label, now, expected) => {
    expect(calculateReceiptRetentionCutoff(isoInstant(now))).toBe(expected);
  });

  it("retains the exact cutoff and expires one instant before it", () => {
    const cutoff = calculateReceiptRetentionCutoff(isoInstant("2026-08-22T06:00:00.000Z"));
    expect(isReceiptContentExpired(cutoff, cutoff)).toBe(false);
    expect(isReceiptContentExpired(isoInstant("2026-05-31T17:59:59.999Z"), cutoff)).toBe(true);
  });

  it("uses receipt creation time independently from an old Expense Date", () => {
    const cutoff = calculateReceiptRetentionCutoff(isoInstant("2026-09-15T06:00:00.000Z"));
    expect(isReceiptContentExpired(available.createdAt, cutoff)).toBe(false);
  });
});
