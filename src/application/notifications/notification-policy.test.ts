import { describe, expect, it } from "vitest";
import { householdId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import { NOTIFICATION_TYPES } from "@/domain/notifications/notification-types";
import { deterministicNotificationId, expenseCommentRecipients, formatNotificationBdt, notificationDraft, uniqueActiveRecipients } from "./notification-policy";

const HOUSEHOLD = householdId("h_home");
const ACTOR = userId("u_actor");
const OTHER = userId("u_other");

describe("notification policy", () => {
  it("freezes the approved event inventory and safe bounded snapshots", () => {
    expect(NOTIFICATION_TYPES).toEqual([
      "join-request-received", "join-request-accepted", "join-request-rejected", "member-joined", "member-left-or-removed", "leadership-transferred", "household-renamed",
      "expense-created", "expense-materially-updated", "expense-deleted", "expense-comment-added", "receipt-added", "receipt-removed",
      "settlement-requested", "settlement-confirmed", "settlement-rejected", "settlement-cancelled",
    ]);
    const row = notificationDraft({ eventKey: "expense-command", recipientUserId: OTHER, type: "expense-created", title: "New expense", body: "Raiyan added Internet Bill — ৳1,200.00", createdAt: isoInstant("2026-09-12T04:00:00.000Z"), householdId: HOUSEHOLD, entityType: "expense", entityId: "e_1" });
    expect(row).toMatchObject({ recipientUserId: OTHER, scope: "household", householdId: HOUSEHOLD, type: "expense-created", entityType: "expense", entityId: "e_1" });
    expect(row.body).not.toContain("@");
    const accountRow = notificationDraft({ eventKey: "remove-command", recipientUserId: ACTOR, type: "member-left-or-removed", title: "Household membership changed", body: "You were removed from the household", createdAt: row.createdAt, accountScoped: true });
    expect(accountRow.scope).toBe("account");
    expect(accountRow).not.toHaveProperty("householdId");
  });

  it("deduplicates active recipients and suppresses the actor", () => {
    const memberships = [
      { householdId: HOUSEHOLD, userId: ACTOR, status: "active" as const, role: "leader" as const },
      { householdId: HOUSEHOLD, userId: OTHER, status: "active" as const, role: "member" as const },
      { householdId: HOUSEHOLD, userId: OTHER, status: "active" as const, role: "member" as const },
      { householdId: HOUSEHOLD, userId: userId("u_former"), status: "former" as const, role: "member" as const },
    ];
    expect(uniqueActiveRecipients(memberships, ACTOR)).toEqual([OTHER]);
  });

  it("explicitly includes the active Expense creator and deduplicates them", () => {
    const creator = userId("u_creator");
    const commenter = userId("u_commenter");
    const third = userId("u_third");
    const memberships = [
      { householdId: HOUSEHOLD, userId: creator, status: "active" as const, role: "member" as const },
      { householdId: HOUSEHOLD, userId: commenter, status: "active" as const, role: "member" as const },
      { householdId: HOUSEHOLD, userId: commenter, status: "active" as const, role: "member" as const },
      { householdId: HOUSEHOLD, userId: third, status: "active" as const, role: "member" as const },
    ];
    expect(expenseCommentRecipients({ creatorId: creator, commenterId: commenter, memberships })).toEqual([creator, third]);
    expect(expenseCommentRecipients({ creatorId: creator, commenterId: creator, memberships })).toEqual([commenter, third]);
    expect(expenseCommentRecipients({ creatorId: creator, commenterId: commenter, memberships: memberships.map((item) => item.userId === creator ? { ...item, status: "former" as const } : item) })).toEqual([third]);
  });

  it("derives a stable id and formats exact integer poisha", () => {
    expect(deterministicNotificationId("event-1", OTHER, "expense-created")).toBe(deterministicNotificationId("event-1", OTHER, "expense-created"));
    expect(deterministicNotificationId("event-1", OTHER, "expense-created")).not.toBe(deterministicNotificationId("event-2", OTHER, "expense-created"));
    expect(formatNotificationBdt(120000)).toBe("৳1,200.00");
    expect(formatNotificationBdt(5)).toBe("৳0.05");
  });
});
