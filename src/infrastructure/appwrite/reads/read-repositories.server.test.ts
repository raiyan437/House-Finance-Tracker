import { describe, expect, it } from "vitest";
import { createAppwriteReadRepositories, settlementPairKey } from "./read-repositories.server";
import { InMemoryTablesReader } from "./in-memory-tables-reader.helper";
import type { UserId } from "@/domain/shared/identifiers";

const INSTANT = "2026-08-20T10:15:30.123Z";

const ACTOR: UserId = "user-raiyan" as UserId;

function repositories(reader: InMemoryTablesReader) {
  return createAppwriteReadRepositories(reader, ACTOR, "raiyan@local.test");
}

describe("Appwrite read repositories", () => {
  it("resolves the actor profile with the authoritative Auth email and hides other full profiles", async () => {
    const reader = new InMemoryTablesReader();
    reader.seed("profiles", [
      { $id: ACTOR, displayName: "Raiyan", version: 1, createdAt: INSTANT, updatedAt: INSTANT },
      { $id: "user-john", displayName: "John", version: 1, createdAt: INSTANT, updatedAt: INSTANT },
    ]);
    const repos = repositories(reader);
    const self = await repos.profiles.getById(ACTOR);
    expect(self?.displayEmail).toBe("raiyan@local.test");
    // Another member's contact-bearing profile does not exist for this actor.
    expect(await repos.profiles.getById("user-john" as UserId)).toBeUndefined();
    const identities = await repos.profiles.getByIds([ACTOR, "user-john" as UserId]);
    expect(identities).toEqual([
      { userId: ACTOR, displayName: "Raiyan" },
      { userId: "user-john", displayName: "John" },
    ]);
  });

  it("hides tombstoned households from direct and code lookups", async () => {
    const reader = new InMemoryTablesReader();
    reader.seed("households", [
      { $id: "h-live", name: "Live House", code: "111111111", version: 1, createdAt: INSTANT, updatedAt: INSTANT },
      { $id: "h-dead", name: "Dead House", code: "222222222", version: 1, createdAt: INSTANT, updatedAt: INSTANT, deletedAt: INSTANT, deletedByUserId: "user-x" },
    ]);
    const repos = repositories(reader);
    expect(await repos.households.getById("h-dead" as never)).toBeUndefined();
    expect((await repos.households.findByCode("111111111"))?.name).toBe("Live House");
    expect(await repos.households.findByCode("222222222")).toBeUndefined();
  });

  it("gates private card snapshots to their owner only", async () => {
    const reader = new InMemoryTablesReader();
    reader.seed("expense_card_private_details", [
      { $id: "e1", ownerId: ACTOR, cardId: "c1", createdAt: INSTANT, snapshotJson: JSON.stringify({ cardName: "Red", cardType: "debit", colorId: "red" }) },
    ]);
    const repos = repositories(reader);
    expect((await repos.expenses.getPrivateCardSnapshot("e1" as never, ACTOR))?.cardId).toBe("c1");
    expect(await repos.expenses.getPrivateCardSnapshot("e1" as never, "someone-else" as UserId)).toBeUndefined();
  });

  it("keys cards by owner and derives removal actions from references", async () => {
    const reader = new InMemoryTablesReader();
    reader.seed("cards", [
      { $id: "c-owned", ownerId: ACTOR, name: "Mine", design: "red", type: "debit", status: "active", archivedAt: null, version: 1, createdAt: INSTANT, updatedAt: INSTANT },
      { $id: "c-foreign", ownerId: "user-john", name: "Theirs", design: "blue", type: "credit", status: "active", archivedAt: null, version: 1, createdAt: INSTANT, updatedAt: INSTANT },
    ]);
    reader.seed("expense_card_private_details", [
      { $id: "e-ref", ownerId: ACTOR, cardId: "c-owned", createdAt: INSTANT, snapshotJson: JSON.stringify({ cardName: "Mine", cardType: "debit", colorId: "red" }) },
    ]);
    const repos = repositories(reader);
    expect((await repos.cards.getOwned("c-foreign" as never, ACTOR))).toBeUndefined();
    expect((await repos.cards.getOwnedRemovalAction("c-owned" as never, ACTOR))).toBe("archive");
    const unreferencedReader = new InMemoryTablesReader();
    unreferencedReader.seed("cards", [{ $id: "c-free", ownerId: ACTOR, name: "Free", design: "black", type: "debit", status: "active", archivedAt: null, version: 1, createdAt: INSTANT, updatedAt: INSTANT }]);
    expect((await repositories(unreferencedReader).cards.getOwnedRemovalAction("c-free" as never, ACTOR))).toBe("delete");
  });

  it("sums available receipt bytes per uploader from metadata only", async () => {
    const reader = new InMemoryTablesReader();
    reader.seed("receipt_metadata", [
      { $id: "r1", uploaderId: ACTOR, householdId: "h1", expenseId: "e1", mimeType: "image/png", sizeBytes: 1000, contentState: "available", contentRemovedAt: null, createdAt: INSTANT },
      { $id: "r2", uploaderId: ACTOR, householdId: "h1", expenseId: "e1", mimeType: "image/jpeg", sizeBytes: 500, contentState: "available", contentRemovedAt: null, createdAt: INSTANT },
      { $id: "r3", uploaderId: ACTOR, householdId: "h1", expenseId: "e1", mimeType: "image/png", sizeBytes: 9999, contentState: "user-deleted", contentRemovedAt: INSTANT, contentRemovedByUserId: ACTOR, createdAt: INSTANT },
    ]);
    expect(await repositories(reader).receipts.availableBytesByUploader(ACTOR)).toBe(1500);
  });

  it("derives the unordered settlement pair key symmetrically", () => {
    const a = "user-a" as UserId;
    const b = "user-b" as UserId;
    expect(settlementPairKey("h1" as never, a, b)).toBe(settlementPairKey("h1" as never, b, a));
    expect(settlementPairKey("h1" as never, a, b)).toContain("user-a");
  });

  it("pages through large result sets with bounded cursors", async () => {
    const reader = new InMemoryTablesReader();
    const memberships = Array.from({ length: 250 }, (_, index) => ({
      $id: `m-${index}`,
      householdId: "h-big",
      userId: `u-${index}`,
      role: "member",
      status: "active",
      joinedAt: INSTANT,
      leftAt: null,
      statusChangedAt: INSTANT,
      version: 1,
    }));
    reader.seed("memberships", memberships);
    const listed = await repositories(reader).memberships.listByHousehold("h-big" as never);
    expect(listed.length).toBe(250);
  });

  it("reads comments oldest-first and derives visible Expense counts in one batched query", async () => {
    const reader = new InMemoryTablesReader();
    reader.seed("expense_comments", [
      { $id: "c3", householdId: "h1", expenseId: "e2", authorUserId: ACTOR, body: "Third", createdAt: "2026-08-20T12:00:00.000Z" },
      { $id: "c2", householdId: "h1", expenseId: "e1", authorUserId: ACTOR, body: "Second", createdAt: "2026-08-20T11:00:00.000Z" },
      { $id: "c1", householdId: "h1", expenseId: "e1", authorUserId: ACTOR, body: "First", createdAt: "2026-08-20T10:00:00.000Z" },
      { $id: "foreign", householdId: "h2", expenseId: "e9", authorUserId: ACTOR, body: "Foreign", createdAt: INSTANT },
    ]);
    const repos = repositories(reader);
    expect((await repos.expenseComments.listForExpense("e1" as never)).map((comment) => comment.commentId)).toEqual(["c1", "c2"]);
    expect(await repos.expenseComments.countForExpenses("h1" as never, ["e1" as never, "e2" as never, "e0" as never])).toEqual(new Map([["e1", 2], ["e2", 1], ["e0", 0]]));
  });

  it("issues no write calls anywhere in the repository surface", async () => {
    const repos = repositories(new InMemoryTablesReader());
    const writeGuards: Array<[string, () => unknown]> = [
      ["households.create", () => repos.households.create({} as never)],
      ["memberships.create", () => repos.memberships.create({} as never)],
      ["expenses? none exist by contract", () => undefined],
      ["settlements.createPending", () => repos.settlements.createPending({} as never)],
      ["cards.create", () => repos.cards.create({} as never)],
      ["receipts.create", () => repos.receipts.create({} as never, {} as never)],
      ["auditEvents.append", () => repos.auditEvents.append({} as never)],
    ];
    for (const [label, invoke] of writeGuards) {
      if (label.includes("?")) continue;
      await expect(Promise.resolve().then(invoke)).rejects.toThrow(/read plane|storage slice|bootstrap/);
    }
  });
});
