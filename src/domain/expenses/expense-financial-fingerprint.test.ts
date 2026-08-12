import { describe, expect, it } from "vitest";

import { expenseDate } from "../dates/expense-date";
import type { MembershipSnapshot } from "../membership/membership-types";
import { poisha, positivePoisha } from "../money/poisha";
import { DomainError } from "../shared/domain-error";
import { householdId, userId } from "../shared/identifiers";
import {
  assertFormerMemberChangeAllowed,
  type ExpenseFinancialFingerprint,
} from "./expense-financial-fingerprint";

const house = householdId("house");
const leader = userId("leader");
const active = userId("active");
const former = userId("former");
const memberships: readonly MembershipSnapshot[] = [
  { householdId: house, userId: leader, status: "active", role: "leader" },
  { householdId: house, userId: active, status: "active", role: "member" },
  { householdId: house, userId: former, status: "former", role: "member" },
];

function fingerprint(): ExpenseFinancialFingerprint {
  return {
    householdId: house,
    amount: positivePoisha(100),
    payerId: active,
    allocations: [
      { participantId: active, share: poisha(40) },
      { participantId: former, share: poisha(60) },
    ],
    expenseDate: expenseDate("2026-08-12"),
    payment: { method: "card", cardReference: "historical-card" },
    deleted: false,
  };
}

function expectFrozenChange(proposed: ExpenseFinancialFingerprint): void {
  expect(() =>
    assertFormerMemberChangeAllowed(fingerprint(), proposed, memberships),
  ).toThrowError(
    expect.objectContaining<Partial<DomainError>>({
      code: "FORMER_MEMBER_FINANCIAL_HISTORY_FROZEN",
    }),
  );
}

describe("former-member financial fingerprint", () => {
  it("allows a provably non-financial edit represented by an unchanged fingerprint", () => {
    const same = {
      ...fingerprint(),
      allocations: [...fingerprint().allocations].reverse(),
    };
    expect(() =>
      assertFormerMemberChangeAllowed(fingerprint(), same, memberships),
    ).not.toThrow();
  });

  it("freezes amount and shares", () => {
    expectFrozenChange({
      ...fingerprint(),
      amount: positivePoisha(101),
      allocations: [
        { participantId: active, share: poisha(41) },
        { participantId: former, share: poisha(60) },
      ],
    });
  });

  it("freezes payer, participant membership, and individual shares", () => {
    expectFrozenChange({ ...fingerprint(), payerId: leader });
    expectFrozenChange({
      ...fingerprint(),
      allocations: [
        { participantId: active, share: poisha(50) },
        { participantId: former, share: poisha(50) },
      ],
    });
    expectFrozenChange({
      ...fingerprint(),
      allocations: [{ participantId: active, share: poisha(100) }],
    });
  });

  it("freezes expense date, payment history, and deleted state", () => {
    expectFrozenChange({
      ...fingerprint(),
      expenseDate: expenseDate("2026-08-13"),
    });
    expectFrozenChange({ ...fingerprint(), payment: { method: "cash" } });
    expectFrozenChange({
      ...fingerprint(),
      payment: { method: "card", cardReference: "different-card" },
    });
    expectFrozenChange({ ...fingerprint(), deleted: true });
  });

  it("rejects adding a former member to previously current-member history", () => {
    const original: ExpenseFinancialFingerprint = {
      ...fingerprint(),
      allocations: [{ participantId: active, share: poisha(100) }],
    };
    expect(() =>
      assertFormerMemberChangeAllowed(original, fingerprint(), memberships),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "FORMER_MEMBER_FINANCIAL_HISTORY_FROZEN",
      }),
    );
  });

  it("does not constrain financial changes when no former member is involved", () => {
    const original: ExpenseFinancialFingerprint = {
      ...fingerprint(),
      allocations: [{ participantId: active, share: poisha(100) }],
    };
    const proposed: ExpenseFinancialFingerprint = {
      ...original,
      amount: positivePoisha(200),
      allocations: [{ participantId: active, share: poisha(200) }],
    };
    expect(() =>
      assertFormerMemberChangeAllowed(original, proposed, memberships),
    ).not.toThrow();
  });
});
