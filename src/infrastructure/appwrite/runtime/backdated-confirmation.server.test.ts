import { describe, expect, it } from "vitest";
import { commandId, settlementId, userId } from "@/domain/shared/identifiers";
import { expenseDate } from "@/domain/dates/expense-date";
import { isoInstant } from "@/domain/shared/instant";
import type { BackdatedExpenseConfirmationPayload } from "@/application/expenses/backdated-expense-confirmation";
import { BACKDATED_CONFIRMATION_VALIDITY_MS, createServerBackdatedConfirmationAuthority } from "./backdated-confirmation.server";

const payload: BackdatedExpenseConfirmationPayload = {
  actorId: userId("u_actor"), commandType: "create-expense", commandId: commandId("k_expense"),
  relevantIntentDigest: "financial-intent-digest", proposedExpenseDate: expenseDate("2026-08-01"),
  qualifyingSettlementId: settlementId("s_boundary"),
  qualifyingSettlementResolvedAt: isoInstant("2026-08-20T10:00:00.000Z"),
};

describe("server backdated Expense confirmation HMAC", () => {
  it("accepts the exact bound warning evidence only during its 15-minute validity", () => {
    let milliseconds = Date.parse("2026-08-26T10:00:00.000Z");
    const authority = createServerBackdatedConfirmationAuthority("test-secret", () => isoInstant(new Date(milliseconds).toISOString()));
    const token = authority.issue(payload);
    expect(authority.verify(token, payload)).toBe(true);
    milliseconds += BACKDATED_CONFIRMATION_VALIDITY_MS - 1;
    expect(authority.verify(token, payload)).toBe(true);
    milliseconds += 1;
    expect(authority.verify(token, payload)).toBe(false);
  });

  it.each([
    ["actor", { ...payload, actorId: userId("u_other") }],
    ["command type", { ...payload, commandType: "edit-expense" as const }],
    ["command ID", { ...payload, commandId: commandId("k_other") }],
    ["financial intent", { ...payload, relevantIntentDigest: "other-digest" }],
    ["Expense Date", { ...payload, proposedExpenseDate: expenseDate("2026-08-02") }],
    ["Settlement", { ...payload, qualifyingSettlementId: settlementId("s_other") }],
    ["Settlement boundary", { ...payload, qualifyingSettlementResolvedAt: isoInstant("2026-08-21T10:00:00.000Z") }],
  ])("rejects a changed %s", (_label, changed) => {
    const authority = createServerBackdatedConfirmationAuthority("test-secret", () => isoInstant("2026-08-26T10:00:00.000Z"));
    expect(authority.verify(authority.issue(payload), changed)).toBe(false);
  });

  it("rejects tampering and a token from a different server secret", () => {
    const now = () => isoInstant("2026-08-26T10:00:00.000Z");
    const authority = createServerBackdatedConfirmationAuthority("test-secret", now);
    const token = authority.issue(payload);
    expect(authority.verify(`${token.slice(0, -1)}x`, payload)).toBe(false);
    expect(createServerBackdatedConfirmationAuthority("other-secret", now).verify(token, payload)).toBe(false);
  });
});
