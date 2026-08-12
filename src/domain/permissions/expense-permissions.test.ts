import { describe, expect, it } from "vitest";

import type { MembershipSnapshot } from "../membership/membership-types";
import { DomainError } from "../shared/domain-error";
import { householdId, userId } from "../shared/identifiers";
import {
  assertCanDeleteExpense,
  assertCanEditExpense,
  assertCanViewExpense,
  getExpensePermissions,
} from "./expense-permissions";

const house = householdId("house");
const leader = userId("leader");
const creator = userId("creator");
const member = userId("member");
const former = userId("former");
const outsider = userId("outsider");
const memberships: readonly MembershipSnapshot[] = [
  { householdId: house, userId: leader, status: "active", role: "leader" },
  { householdId: house, userId: creator, status: "active", role: "member" },
  { householdId: house, userId: member, status: "active", role: "member" },
  { householdId: house, userId: former, status: "former", role: "member" },
];

describe("expense permissions", () => {
  it.each([
    [creator, { canView: true, canEdit: true, canDelete: true }],
    [leader, { canView: true, canEdit: true, canDelete: true }],
    [member, { canView: true, canEdit: false, canDelete: false }],
    [former, { canView: false, canEdit: false, canDelete: false }],
    [outsider, { canView: false, canEdit: false, canDelete: false }],
  ] as const)("returns the frozen creator/leader/member matrix", (actor, expected) => {
    expect(getExpensePermissions(house, actor, creator, memberships)).toEqual(
      expected,
    );
  });

  it("exposes stable permission errors", () => {
    const normal = getExpensePermissions(house, member, creator, memberships);
    expect(() => assertCanEditExpense(normal)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "EXPENSE_EDIT_FORBIDDEN",
      }),
    );
    expect(() => assertCanDeleteExpense(normal)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "EXPENSE_DELETE_FORBIDDEN",
      }),
    );
    expect(() =>
      assertCanViewExpense(
        getExpensePermissions(house, outsider, creator, memberships),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<DomainError>>({
        code: "EXPENSE_VIEW_FORBIDDEN",
      }),
    );
  });
});
