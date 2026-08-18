import { describe, expect, it } from "vitest";

import type { HouseholdBalanceSheet } from "@/domain/balances/balance-types";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import { poisha, positivePoisha } from "@/domain/money/poisha";
import type { UserProfile } from "@/domain/records/domain-records";
import {
  householdId,
  settlementId,
  userId,
} from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import type {
  SettlementRecommendation,
  SettlementRecord,
} from "@/domain/settlements/settlement-types";
import { buildSettlementPageView } from "./settlement-page";

const household = householdId("house-settlement-page");
const alice = userId("alice");
const bob = userId("bob");
const chris = userId("chris");
const createdAt = isoInstant("2026-08-18T10:00:00.000Z");

const memberships: readonly MembershipSnapshot[] = [alice, bob, chris].map((id) => ({
  householdId: household,
  userId: id,
  status: "active" as const,
  role: id === alice ? "leader" as const : "member" as const,
}));

const profiles: readonly UserProfile[] = [
  { userId: alice, displayName: "Alice", displayEmail: "alice@example.test", emailKey: "alice@example.test", createdAt, updatedAt: createdAt },
  { userId: bob, displayName: "Bob", displayEmail: "bob@example.test", emailKey: "bob@example.test", createdAt, updatedAt: createdAt },
  { userId: chris, displayName: "Chris", displayEmail: "chris@example.test", emailKey: "chris@example.test", createdAt, updatedAt: createdAt },
];

function sheet(aliceBalance: number, bobBalance: number, chrisBalance = 0): HouseholdBalanceSheet {
  const creditor = [aliceBalance, bobBalance, chrisBalance]
    .filter((value) => value > 0)
    .reduce((sum, value) => sum + value, 0);
  return {
    householdId: household,
    balances: [
      { householdId: household, memberId: alice, balance: poisha(aliceBalance) },
      { householdId: household, memberId: bob, balance: poisha(bobBalance) },
      { householdId: household, memberId: chris, balance: poisha(chrisBalance) },
    ],
    totalCreditorValue: poisha(creditor),
    totalDebtorMagnitude: poisha(creditor),
  };
}

function recommendation(
  senderId = alice,
  receiverId = bob,
  amount = 1000,
): SettlementRecommendation {
  return { householdId: household, senderId, receiverId, amount: positivePoisha(amount) };
}

function pending(amount = 1000): SettlementRecord {
  const origin = recommendation(alice, bob, amount);
  return {
    settlementId: settlementId(`pending-${amount}`),
    householdId: household,
    senderId: alice,
    receiverId: bob,
    amount: positivePoisha(amount),
    originatingRecommendation: origin,
    createdAt,
    status: "pending",
  };
}

describe("settlement page projection", () => {
  it("maps one signed net balance into two always-present summary values", () => {
    const owing = buildSettlementPageView({
      householdId: household,
      actorId: alice,
      sheet: sheet(-1000, 1000),
      recommendations: [recommendation()],
      settlements: [],
      memberships,
      profiles,
    });
    expect(owing.summary).toEqual({ youOwe: 1000, youAreOwed: 0, settled: false });

    const owed = buildSettlementPageView({
      householdId: household,
      actorId: bob,
      sheet: sheet(-1000, 1000),
      recommendations: [recommendation()],
      settlements: [],
      memberships,
      profiles,
    });
    expect(owed.summary).toEqual({ youOwe: 0, youAreOwed: 1000, settled: false });
  });

  it("projects only current-user recommendations and blocks an existing unordered-pair Pending claim", () => {
    const unrelated = recommendation(chris, bob, 200);
    const view = buildSettlementPageView({
      householdId: household,
      actorId: alice,
      sheet: sheet(-1000, 1200, -200),
      recommendations: [recommendation(), unrelated],
      settlements: [pending()],
      memberships,
      profiles,
    });
    expect(view.recommendations).toHaveLength(1);
    expect(view.recommendations[0]).toMatchObject({
      direction: "outgoing",
      canMarkPaid: false,
      counterparty: { displayName: "Bob" },
    });
    expect(view.pending[0]).toMatchObject({
      relationship: "sender",
      allowedActions: { confirm: false, reject: false, cancel: true },
    });
    expect(view.pending[0]?.warning).toBeUndefined();
    expect(view.actionablePendingCount).toBe(0);
  });

  it("gives only the receiver attention actions and translates every stale state", () => {
    const amountChanged = buildSettlementPageView({
      householdId: household,
      actorId: bob,
      sheet: sheet(-1000, 1000),
      recommendations: [recommendation()],
      settlements: [pending(500)],
      memberships,
      profiles,
    });
    expect(amountChanged.pending[0]).toMatchObject({
      relationship: "receiver",
      allowedActions: { confirm: true, reject: true, cancel: false },
      warning: { heading: "Your household balance has changed" },
    });
    expect(amountChanged.actionablePendingCount).toBe(1);

    const absent = buildSettlementPageView({
      householdId: household,
      actorId: bob,
      sheet: sheet(0, 0),
      recommendations: [],
      settlements: [pending(500)],
      memberships,
      profiles,
    });
    expect(absent.pending[0]?.warning?.heading).toMatch(/no longer in the current settlement plan/i);

    const reversed = buildSettlementPageView({
      householdId: household,
      actorId: bob,
      sheet: sheet(1000, -1000),
      recommendations: [recommendation(bob, alice)],
      settlements: [pending(500)],
      memberships,
      profiles,
    });
    expect(reversed.pending[0]?.warning?.heading).toMatch(/other direction/i);
  });

  it("keeps Pending out of household history and applies deterministic terminal ordering", () => {
    const terminal = (
      id: string,
      status: "confirmed" | "rejected" | "cancelled",
      created: string,
      resolved: string,
    ): SettlementRecord => ({
      ...pending(),
      settlementId: settlementId(id),
      createdAt: isoInstant(created),
      status,
      resolvedAt: isoInstant(resolved),
    });
    const view = buildSettlementPageView({
      householdId: household,
      actorId: alice,
      sheet: sheet(0, 0),
      recommendations: [],
      settlements: [
        pending(),
        terminal("history-b", "confirmed", "2026-08-18T09:00:00.000Z", "2026-08-18T12:00:00.000Z"),
        terminal("history-a", "rejected", "2026-08-18T09:00:00.000Z", "2026-08-18T12:00:00.000Z"),
        terminal("history-newer-created", "cancelled", "2026-08-18T10:00:00.000Z", "2026-08-18T12:00:00.000Z"),
      ],
      memberships,
      profiles,
    });
    expect(view.history.map((item) => item.settlementId)).toEqual([
      "history-newer-created",
      "history-a",
      "history-b",
    ]);
  });
});
