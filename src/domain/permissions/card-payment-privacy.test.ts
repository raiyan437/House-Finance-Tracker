import { describe, expect, it } from "vitest";

import type { MembershipSnapshot } from "../membership/membership-types";
import { DomainError } from "../shared/domain-error";
import { householdId, userId } from "../shared/identifiers";
import {
  applyExpensePaymentEdit,
  projectExpensePayment,
  type ExpensePayment,
} from "./card-payment-privacy";

const house = householdId("house");
const leader = userId("leader");
const owner = userId("owner");
const member = userId("member");
const memberships: readonly MembershipSnapshot[] = [
  { householdId: house, userId: leader, status: "active", role: "leader" },
  { householdId: house, userId: owner, status: "active", role: "member" },
  { householdId: house, userId: member, status: "active", role: "member" },
];
const card: ExpensePayment = {
  method: "card",
  cardReference: "private-card-reference",
};

describe("private card payment capabilities", () => {
  it("projects an owner's opaque reference only to the owner", () => {
    expect(projectExpensePayment(owner, owner, card)).toEqual(card);
    const leaderProjection = projectExpensePayment(leader, owner, card);
    expect(leaderProjection).toEqual({ method: "card" });
    expect("cardReference" in leaderProjection).toBe(false);
    const memberProjection = projectExpensePayment(member, owner, card);
    expect("cardReference" in memberProjection).toBe(false);
  });

  it("lets a non-owner leader preserve a private reference without receiving it", () => {
    expect(
      applyExpensePaymentEdit(
        house,
        leader,
        owner,
        memberships,
        card,
        { kind: "preserve" },
      ),
    ).toBe(card);
  });

  it("lets a non-owner leader change Card to Cash", () => {
    expect(
      applyExpensePaymentEdit(
        house,
        leader,
        owner,
        memberships,
        card,
        {
          kind: "change-to-cash",
          confirmedPrivateReferenceDetachment: true,
        },
      ),
    ).toEqual({ method: "cash" });
  });

  it("requires explicit confirmation before detaching a private card reference", () => {
    expect(() =>
      applyExpensePaymentEdit(
        house,
        leader,
        owner,
        memberships,
        card,
        {
          kind: "change-to-cash",
          confirmedPrivateReferenceDetachment: false,
        },
      ),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "PRIVATE_CARD_ACCESS_FORBIDDEN",
      }),
    );
  });

  it("prevents a non-owner leader from selecting or changing a card", () => {
    expect(() =>
      applyExpensePaymentEdit(
        house,
        leader,
        owner,
        memberships,
        card,
        { kind: "select-card", cardReference: "another-private-card" },
      ),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "PRIVATE_CARD_ACCESS_FORBIDDEN",
      }),
    );
    expect(() =>
      applyExpensePaymentEdit(
        house,
        leader,
        owner,
        memberships,
        { method: "cash" },
        { kind: "select-card", cardReference: "private-card" },
      ),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "PRIVATE_CARD_ACCESS_FORBIDDEN",
      }),
    );
  });

  it("lets the owner select a card and blocks a normal member from edits", () => {
    expect(
      applyExpensePaymentEdit(
        house,
        owner,
        owner,
        memberships,
        { method: "cash" },
        { kind: "select-card", cardReference: "owner-card" },
      ),
    ).toEqual({ method: "card", cardReference: "owner-card" });

    expect(() =>
      applyExpensePaymentEdit(
        house,
        member,
        owner,
        memberships,
        card,
        { kind: "preserve" },
      ),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "EXPENSE_EDIT_FORBIDDEN",
      }),
    );
  });
});
