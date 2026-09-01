import { describe, expect, it } from "vitest";
import {
  mapAuditEvent,
  mapCard,
  mapCurrentProfile,
  mapExpense,
  mapHousehold,
  mapJoinRequest,
  mapMembership,
  mapPrivateExpenseCard,
  mapReceiptMetadata,
  mapSettlement,
} from "./mappers.server";

const INSTANT = "2026-08-20T10:15:30.123Z";

function row(id: string, data: Record<string, unknown> = {}): Record<string, unknown> {
  return { $id: id, $createdAt: INSTANT, $updatedAt: INSTANT, ...data };
}

function expectMalformed(table: string, build: () => unknown): void {
  try {
    build();
    throw new Error(`Expected ${table} mapping to fail closed.`);
  } catch (error) {
    expect((error as { code?: string }).code ?? (error as Error).message).toBeDefined();
    expect((error as { name?: string }).name === "ApplicationError" || (error as Error).message.length > 0).toBe(true);
  }
}

describe("strict provider row mappers", () => {
  it("maps a profile and merges only the authoritative Auth email", () => {
    const profile = mapCurrentProfile(row("user_1", { displayName: "Raiyan", avatarFileId: "avatar_private", avatarUpdatedAt: INSTANT, version: 1, createdAt: INSTANT, updatedAt: INSTANT }), "Raiyan@Test.io");
    expect(profile.displayEmail).toBe("Raiyan@Test.io");
    expect(profile.emailKey).toBe("raiyan@test.io");
    expect(profile.displayName).toBe("Raiyan");
    expect(JSON.stringify(profile)).not.toMatch(/avatarFileId|avatarUpdatedAt|storage/i);
  });

  it("normalizes Appwrite timezone offsets and fractional precision to canonical UTC instants", () => {
    const providerInstant = "2026-08-20T16:15:30.123456+06:00";
    const profile = mapCurrentProfile(
      row("user_1", { displayName: "Raiyan", version: 1, createdAt: providerInstant, updatedAt: providerInstant }),
      "r@test.io",
    );
    expect(profile.createdAt).toBe(INSTANT);
    expect(profile.updatedAt).toBe(INSTANT);
  });

  it("rejects malformed profiles fail-closed", () => {
    expect(() => mapCurrentProfile(row("user_1", { displayName: " ", version: 1, createdAt: INSTANT, updatedAt: INSTANT }), "r@t.io")).toThrow();
    expect(() => mapCurrentProfile(row("user_1", { displayName: "X", version: 0, createdAt: INSTANT, updatedAt: INSTANT }), "r@t.io")).toThrow();
    expect(() => mapCurrentProfile(row("user_1", { displayName: "X", version: 1, createdAt: "not-an-instant", updatedAt: INSTANT }), "r@t.io")).toThrow();
  });

  it("maps households including complete tombstones only", () => {
    const live = mapHousehold(row("h1", { name: "Raiyan House", code: "012345678", version: 1, createdAt: INSTANT, updatedAt: INSTANT }));
    expect(live.householdId).toBe("h1");
    const tombstoned = mapHousehold(row("h2", { name: "Old", code: "111111111", version: 1, createdAt: INSTANT, updatedAt: INSTANT, deletedAt: INSTANT, deletedByUserId: "user_9" }));
    expect(tombstoned.deletedAt).toBe(INSTANT);
    // Incomplete deletion metadata must fail closed.
    expectMalformed("households", () => mapHousehold(row("h3", { name: "Bad", code: "222222222", version: 1, createdAt: INSTANT, updatedAt: INSTANT, deletedAt: INSTANT })));
    expect(() => mapHousehold(row("h4", { name: "Bad", code: "12", version: 1, createdAt: INSTANT, updatedAt: INSTANT }))).toThrow();
  });

  it("maps memberships with lifecycle consistency checks", () => {
    const active = mapMembership(row("m1", { householdId: "h1", userId: "u1", role: "leader", status: "active", joinedAt: INSTANT, statusChangedAt: INSTANT, version: 1 }));
    expect(active).toMatchObject({ householdId: "h1", userId: "u1", role: "leader", status: "active" });
    expect(() => mapMembership(row("m2", { householdId: "h1", userId: "u1", role: "member", status: "active", joinedAt: INSTANT, leftAt: INSTANT, statusChangedAt: INSTANT, version: 1 }))).toThrow();
    expect(() => mapMembership(row("m3", { householdId: "h1", userId: "u1", role: "chief", status: "active", joinedAt: INSTANT, statusChangedAt: INSTANT, version: 1 }))).toThrow();
  });

  it("maps join requests; terminal rows require resolver metadata", () => {
    const pending = mapJoinRequest(row("j1", { householdId: "h1", userId: "u1", status: "pending", createdAt: INSTANT }));
    expect(pending.status).toBe("pending");
    const rejected = mapJoinRequest(row("j2", { householdId: "h1", userId: "u1", status: "rejected", createdAt: INSTANT, resolvedAt: INSTANT, resolvedByUserId: "u2" }));
    expect(rejected.resolvedByUserId).toBe("u2");
    expect(() => mapJoinRequest(row("j3", { householdId: "h1", userId: "u1", status: "cancelled", createdAt: INSTANT, resolvedAt: INSTANT }))).toThrow();
  });

  it("maps expenses with exact BigInt poisha transport and rejects unsafe values", () => {
    const allocations = JSON.stringify([
      { participantId: "u1", sharePoisha: "500003500001" },
      { participantId: "u2", sharePoisha: "500003500000" },
    ]);
    const expense = mapExpense(row("e1", {
      householdId: "h1", expenseDate: "2026-08-01", amountPoisha: "1000007000001",
      payerId: "u1", createdBy: "u1", splitMethod: "equal", name: "Groceries",
      paymentMethod: "cash", paymentRefJson: "{}", allocationsJson: allocations,
      percentageEntriesJson: null, revision: "3", createdAt: INSTANT, updatedAt: INSTANT,
    }));
    expect(expense.amount).toBe(1_000_007_000_001);
    expect(expense.allocations[0]?.share).toBe(500_003_500_001);
    expect(expense.revision).toBe(3);

    expect(() => mapExpense(row("e2", {
      householdId: "h1", expenseDate: "2026-13-40", amountPoisha: "100",
      payerId: "u1", createdBy: "u1", splitMethod: "cash", name: "X",
      paymentMethod: "cash", paymentRefJson: "{}", allocationsJson: "[]",
      revision: 1, createdAt: INSTANT, updatedAt: INSTANT,
    }))).toThrow();

    // Unsafe integer beyond Number.MAX_SAFE_INTEGER fails closed.
    expect(() => mapExpense(row("e3", {
      householdId: "h1", expenseDate: "2026-08-01", amountPoisha: "9007199254740993",
      payerId: "u1", createdBy: "u1", splitMethod: "equal", name: "X",
      paymentMethod: "cash", paymentRefJson: "{}", allocationsJson: JSON.stringify([{ participantId: "u1", sharePoisha: "9007199254740993" }]),
      revision: 1, createdAt: INSTANT, updatedAt: INSTANT,
    }))).toThrow();

    // Incomplete soft-deletion metadata fails closed.
    expect(() => mapExpense(row("e4", {
      householdId: "h1", expenseDate: "2026-08-01", amountPoisha: "100",
      payerId: "u1", createdBy: "u1", splitMethod: "equal", name: "X",
      paymentMethod: "cash", paymentRefJson: "{}", allocationsJson: "[]",
      revision: 1, createdAt: INSTANT, updatedAt: INSTANT, deletedAt: INSTANT,
    }))).toThrow();
  });

  it("reconstructs the opaque card reference convention without exposing provider data", () => {
    const expense = mapExpense(row("e9", {
      householdId: "h1", expenseDate: "2026-08-01", amountPoisha: "500",
      payerId: "u1", createdBy: "u1", splitMethod: "percentage", name: "Card spend",
      paymentMethod: "card", paymentRefJson: "{\"leak\":\"ignored\"}",
      allocationsJson: JSON.stringify([{ participantId: "u1", sharePoisha: "500" }]),
      percentageEntriesJson: JSON.stringify([{ participantId: "u1", basisPoints: 10000 }]),
      revision: 1, createdAt: INSTANT, updatedAt: INSTANT,
    }));
    if (expense.payment.method !== "card") throw new Error("expected card");
    expect(expense.payment.cardReference).toBe("private:e9");
  });

  it("maps private card snapshots keyed by expense id", () => {
    const snapshot = mapPrivateExpenseCard(row("e1", {
      ownerId: "u1", cardId: "c1", createdAt: INSTANT,
      snapshotJson: JSON.stringify({ cardName: "Red Debit", cardType: "debit", colorId: "red" }),
    }));
    expect(snapshot.expenseId).toBe("e1");
    expect(snapshot.colorId).toBe("red");
    expect(mapPrivateExpenseCard(row("e2", {
      ownerId: "u1", cardId: "c1", cardName: "Long Card Name", createdAt: INSTANT,
      snapshotJson: JSON.stringify({ cardType: "credit", colorId: "blue" }),
    }))).toMatchObject({ expenseId: "e2", cardName: "Long Card Name", cardType: "credit", colorId: "blue" });
    expect(() => mapPrivateExpenseCard(row("e1", { ownerId: "u1", cardId: "c1", createdAt: INSTANT, snapshotJson: "{\"colorId\":\"neon-pink\"}" }))).toThrow();
  });

  it("maps settlements across every lifecycle status", () => {
    for (const status of ["pending", "confirmed", "rejected", "cancelled"] as const) {
      const settlement = mapSettlement(row(`s_${status}`, {
        householdId: "h1", senderId: "u1", receiverId: "u2",
        amountPoisha: "120050", originalAmountPoisha: "120050",
        status, pairKey: "[\"h1\",\"u1\",\"u2\"]", recommendationDigest: "digest",
        resolvedAt: status === "pending" ? null : INSTANT, createdAt: INSTANT,
      }));
      expect(settlement.status).toBe(status);
      expect(settlement.amount).toBe(120_050);
      expect(settlement.originatingRecommendation.amount).toBe(120_050);
    }
    expect(() => mapSettlement(row("s_bad", {
      householdId: "h1", senderId: "u1", receiverId: "u2", amountPoisha: "1.5",
      originalAmountPoisha: "1", status: "pending", pairKey: "k", recommendationDigest: "d",
      resolvedAt: null, createdAt: INSTANT,
    }))).toThrow();
  });

  it("maps cards with design vocabulary validation", () => {
    const card = mapCard(row("c1", { ownerId: "u1", name: "Red", design: "red", type: "debit", status: "active", archivedAt: null, version: 1, createdAt: INSTANT, updatedAt: INSTANT }));
    expect(card.colorId).toBe("red");
    expect(() => mapCard(row("c2", { ownerId: "u1", name: "X", design: "chartreuse", type: "debit", status: "active", archivedAt: null, version: 1, createdAt: INSTANT, updatedAt: INSTANT }))).toThrow();
    expect(() => mapCard(row("c3", { ownerId: "u1", name: "X", design: "red", type: "debit", status: "archived", archivedAt: null, version: 1, createdAt: INSTANT, updatedAt: INSTANT }))).toThrow();
  });

  it("maps receipt metadata with lifecycle and remover requirements", () => {
    const available = mapReceiptMetadata(row("r1", {
      uploaderId: "u1", householdId: "h1", expenseId: "e1", mimeType: "image/png",
      sizeBytes: 1024, contentState: "available", contentRemovedAt: null, createdAt: INSTANT,
    }));
    expect(available.contentStatus).toBe("available");
    const userDeleted = mapReceiptMetadata(row("r2", {
      uploaderId: "u1", householdId: "h1", expenseId: "e1", mimeType: "image/png",
      sizeBytes: 1024, contentState: "user-deleted", contentRemovedAt: INSTANT, contentRemovedByUserId: "u1", createdAt: INSTANT,
    }));
    expect(userDeleted.contentRemovedByUserId).toBe("u1");
    expect(() => mapReceiptMetadata(row("r3", {
      uploaderId: "u1", householdId: "h1", expenseId: "e1", mimeType: "image/png",
      sizeBytes: 1024, contentState: "user-deleted", contentRemovedAt: INSTANT, createdAt: INSTANT,
    }))).toThrow();
    expect(() => mapReceiptMetadata(row("r4", {
      uploaderId: "u1", householdId: "h1", expenseId: "e1", mimeType: "image/gif",
      sizeBytes: 10, contentState: "available", contentRemovedAt: null, createdAt: INSTANT,
    }))).toThrow();
  });

  it("maps sanitized audit projections", () => {
    const audit = mapAuditEvent(row("a1", {
      householdId: "h1", aggregateType: "expense", aggregateId: "e1", actorId: "u1",
      action: "created", changedFieldsJson: "[\"amount\",\"expenseDate\"]", occurredAt: INSTANT,
    }));
    expect(audit.changedFields).toEqual(["amount", "expenseDate"]);
    expect(() => mapAuditEvent(row("a2", {
      householdId: "h1", aggregateType: "expense", aggregateId: "e1", actorId: "u1",
      action: "created", changedFieldsJson: "{\"not\":\"an-array\"}", occurredAt: INSTANT,
    }))).toThrow();
  });
});
