import { describe, expect, it } from "vitest";
import { positivePoisha } from "../money/poisha";
import { expenseDate } from "../dates/expense-date";
import { householdId, settlementId, userId } from "../shared/identifiers";
import { isoInstant } from "../shared/instant";
import type { SettlementRecord } from "../settlements/settlement-types";
import { isBackdatedAfterSettlement, latestConfirmedSettlementBefore } from "./backdated-expense-policy";

const household = householdId("household-1");
const sender = userId("user-1");
const receiver = userId("user-2");

function settlement(id: string, resolvedAt: string, status: SettlementRecord["status"] = "confirmed"): SettlementRecord {
  return {
    settlementId: settlementId(id), householdId: household, senderId: sender, receiverId: receiver,
    amount: positivePoisha(100), originatingRecommendation: { householdId: household, senderId: sender, receiverId: receiver, amount: positivePoisha(100) },
    createdAt: isoInstant("2026-08-20T00:00:00.000Z"), status,
    ...(status === "pending" ? {} : { resolvedAt: isoInstant(resolvedAt) }),
  };
}

describe("backdated Expense policy", () => {
  it("selects only the latest Confirmed Settlement strictly before the command", () => {
    const boundary = latestConfirmedSettlementBefore(household, isoInstant("2026-08-22T00:00:00.000Z"), [
      settlement("older", "2026-08-20T18:00:00.000Z"),
      settlement("latest", "2026-08-21T18:00:00.000Z"),
      settlement("equal", "2026-08-22T00:00:00.000Z"),
      settlement("rejected", "2026-08-21T23:00:00.000Z", "rejected"),
    ]);
    expect(boundary).toEqual({ settlementId: "latest", resolvedAt: "2026-08-21T18:00:00.000Z", businessDate: "2026-08-22" });
  });

  it("warns on equality and earlier dates, but not later dates", () => {
    const boundary = latestConfirmedSettlementBefore(household, isoInstant("2026-08-23T00:00:00.000Z"), [settlement("s1", "2026-08-20T18:00:00.000Z")]);
    expect(isBackdatedAfterSettlement(expenseDate("2026-08-20"), boundary)).toBe(true);
    expect(isBackdatedAfterSettlement(expenseDate("2026-08-21"), boundary)).toBe(true);
    expect(isBackdatedAfterSettlement(expenseDate("2026-08-22"), boundary)).toBe(false);
  });
});
