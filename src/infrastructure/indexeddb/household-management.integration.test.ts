import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IDBPDatabase } from "idb";

import type { AuditEvent, Expense, Household, JoinRequest } from "@/domain/records/domain-records";
import { expenseDate } from "@/domain/dates/expense-date";
import { poisha, positivePoisha } from "@/domain/money/poisha";
import {
  auditEventId,
  expenseId,
  householdId,
  joinRequestId,
  settlementId,
  userId,
  type HouseholdId,
  type UserId,
} from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";
import { IndexedDbAtomicApplicationPersistence } from "./atomic-persistence";
import { deleteLocalDatabase, openLocalDatabase } from "./database";
import {
  toAuditRecord,
  toExpenseRecord,
  toJoinRequestRecord,
  toSettlementRecord,
} from "./mappers";
import { IndexedDbRepositories } from "./repositories";
import type { HouseFinanceDatabase } from "./records";
import {
  SEEDED_HOUSEHOLD_ID,
  SEEDED_USER_IDS,
  seedLocalDatabase,
} from "./seed";

const now = isoInstant("2026-08-19T12:00:00.000Z");

function event(
  id: string,
  house: HouseholdId,
  actor: UserId,
  action: string,
  aggregateType: AuditEvent["aggregateType"] = "membership",
  aggregateId: string = actor,
): AuditEvent {
  return {
    auditEventId: auditEventId(`phase-10-${id}`),
    householdId: house,
    actorId: actor,
    aggregateType,
    aggregateId,
    action,
    occurredAt: now,
    changedFields: ["status"],
  };
}

function expense(
  house: HouseholdId,
  payerId: UserId,
  participantId: UserId,
  id: string,
): Expense {
  return {
    expenseId: expenseId(id),
    householdId: house,
    creatorId: payerId,
    payerId,
    name: "Commit-time balance change",
    amount: positivePoisha(100),
    expenseDate: expenseDate("2026-08-19"),
    splitMethod: "amount",
    allocations: [{ participantId, share: poisha(100) }],
    payment: { method: "cash" },
    createdAt: now,
    updatedAt: now,
  };
}

function pendingSettlement(
  house: HouseholdId,
  senderId: UserId,
  receiverId: UserId,
  id: string,
): SettlementRecord {
  const recommendation = {
    householdId: house,
    senderId,
    receiverId,
    amount: positivePoisha(1),
  };
  return {
    settlementId: settlementId(id),
    householdId: house,
    senderId,
    receiverId,
    amount: positivePoisha(1),
    originatingRecommendation: recommendation,
    createdAt: now,
    status: "pending",
  };
}

describe("Phase 10 authoritative household management persistence", () => {
  let databaseName: string;
  let db: IDBPDatabase<HouseFinanceDatabase>;
  let repositories: IndexedDbRepositories;
  let atomic: IndexedDbAtomicApplicationPersistence;

  beforeEach(async () => {
    databaseName = `phase-10-management-${crypto.randomUUID()}`;
    db = await openLocalDatabase(databaseName);
    repositories = new IndexedDbRepositories(db);
    atomic = new IndexedDbAtomicApplicationPersistence(db);
  });

  afterEach(async () => {
    db.close();
    await deleteLocalDatabase(databaseName);
  });

  async function createHouse(
    label: string,
    leader: UserId,
    members: readonly UserId[] = [],
  ): Promise<Household> {
    const household: Household = {
      householdId: householdId(`house-${label}`),
      name: `${label} House`,
      code: label.padStart(9, "0").slice(-9),
      createdAt: now,
      updatedAt: now,
    };
    await repositories.households.create(household);
    await repositories.memberships.create({
      householdId: household.householdId,
      userId: leader,
      status: "active",
      role: "leader",
    });
    for (const member of members) {
      await repositories.memberships.create({
        householdId: household.householdId,
        userId: member,
        status: "active",
        role: "member",
      });
    }
    return household;
  }

  it("transfers exactly one active Leader despite balances and a Pending Settlement", async () => {
    const leader = userId("transfer-leader");
    const target = userId("transfer-target");
    const house = await createHouse("101", leader, [target]);
    await db.add("expenses", toExpenseRecord(expense(house.householdId, leader, target, "transfer-expense")));
    await db.add("settlements", toSettlementRecord(pendingSettlement(house.householdId, target, leader, "transfer-pending")));

    await atomic.transferLeadership({
      householdId: house.householdId,
      actorId: leader,
      targetId: target,
      auditEvent: event("transfer", house.householdId, leader, "leadership-transferred", "membership", target),
    });

    const memberships = await repositories.memberships.listByHousehold(house.householdId);
    expect(memberships.find(({ userId: id }) => id === leader)).toMatchObject({ status: "active", role: "member" });
    expect(memberships.find(({ userId: id }) => id === target)).toMatchObject({ status: "active", role: "leader" });
    expect(memberships.filter(({ status, role }) => status === "active" && role === "leader")).toHaveLength(1);
  });

  it("rejects stale transfer authority without changing either role", async () => {
    const oldLeader = userId("stale-old-leader");
    const newLeader = userId("stale-new-leader");
    const house = await createHouse("102", oldLeader, [newLeader]);
    await repositories.memberships.replace({ householdId: house.householdId, userId: oldLeader, status: "active", role: "member" });
    await repositories.memberships.replace({ householdId: house.householdId, userId: newLeader, status: "active", role: "leader" });

    await expect(atomic.transferLeadership({
      householdId: house.householdId,
      actorId: oldLeader,
      targetId: newLeader,
      auditEvent: event("stale-transfer", house.householdId, oldLeader, "leadership-transferred", "membership", newLeader),
    })).rejects.toMatchObject({ code: "HOUSEHOLD_STATE_CHANGED" });

    expect(await repositories.memberships.get(house.householdId, oldLeader)).toMatchObject({ role: "member" });
    expect(await repositories.memberships.get(house.householdId, newLeader)).toMatchObject({ role: "leader" });
  });

  it("releases the active-membership uniqueness key after Leave and Remove", async () => {
    const leader = userId("departure-leader");
    const leaving = userId("leaving-member");
    const removed = userId("removed-member");
    const house = await createHouse("103", leader, [leaving, removed]);

    await atomic.leaveHousehold({
      householdId: house.householdId,
      actorId: leaving,
      auditEvent: event("leave", house.householdId, leaving, "left"),
    });
    await atomic.removeHouseholdMember({
      householdId: house.householdId,
      actorId: leader,
      targetId: removed,
      auditEvent: event("remove", house.householdId, leader, "removed", "membership", removed),
    });

    expect(await repositories.memberships.get(house.householdId, leaving)).toMatchObject({ status: "former", role: "member" });
    expect(await repositories.memberships.get(house.householdId, removed)).toMatchObject({ status: "former", role: "member" });
    expect(await repositories.memberships.findActiveByUser(leaving)).toBeUndefined();
    expect(await repositories.memberships.findActiveByUser(removed)).toBeUndefined();

    await atomic.createHousehold({
      household: { householdId: householdId("house-leaver-next"), name: "Leaver Next", code: "000000104", createdAt: now, updatedAt: now },
      leaderMembership: { householdId: householdId("house-leaver-next"), userId: leaving, status: "active", role: "leader" },
      auditEvent: event("leaver-next", householdId("house-leaver-next"), leaving, "created", "household", "house-leaver-next"),
    });
    await atomic.createHousehold({
      household: { householdId: householdId("house-removed-next"), name: "Removed Next", code: "000000105", createdAt: now, updatedAt: now },
      leaderMembership: { householdId: householdId("house-removed-next"), userId: removed, status: "active", role: "leader" },
      auditEvent: event("removed-next", householdId("house-removed-next"), removed, "created", "household", "house-removed-next"),
    });
  });

  it("rejects stale Leave and Remove when current financial state no longer permits departure", async () => {
    const leader = userId("financial-leader");
    const debtor = userId("financial-debtor");
    const creditor = userId("financial-creditor");
    const house = await createHouse("106", leader, [debtor, creditor]);
    await db.add("expenses", toExpenseRecord(expense(house.householdId, creditor, debtor, "stale-financial")));

    await expect(atomic.leaveHousehold({
      householdId: house.householdId,
      actorId: debtor,
      auditEvent: event("stale-leave", house.householdId, debtor, "left"),
    })).rejects.toMatchObject({ code: "HOUSEHOLD_STATE_CHANGED" });
    await expect(atomic.removeHouseholdMember({
      householdId: house.householdId,
      actorId: leader,
      targetId: creditor,
      auditEvent: event("stale-remove", house.householdId, leader, "removed", "membership", creditor),
    })).rejects.toMatchObject({ code: "HOUSEHOLD_STATE_CHANGED" });

    expect(await repositories.memberships.get(house.householdId, debtor)).toMatchObject({ status: "active" });
    expect(await repositories.memberships.get(house.householdId, creditor)).toMatchObject({ status: "active" });
  });

  it("closes only Pending Join Requests during deletion and releases every active uniqueness key", async () => {
    const leader = userId("delete-leader");
    const member = userId("delete-member");
    const historicalLeader = userId("historical-delete-leader");
    const requester = userId("delete-requester");
    const house = await createHouse("107", leader, [member]);
    await repositories.memberships.create({ householdId: house.householdId, userId: historicalLeader, status: "former", role: "leader" });
    const pending: JoinRequest = { joinRequestId: joinRequestId("delete-pending"), householdId: house.householdId, userId: requester, status: "pending", createdAt: now };
    const accepted: JoinRequest = { ...pending, joinRequestId: joinRequestId("delete-accepted"), userId: userId("accepted-requester"), status: "accepted", resolvedAt: now, resolvedByUserId: leader };
    const rejected: JoinRequest = { ...accepted, joinRequestId: joinRequestId("delete-rejected"), userId: userId("rejected-requester"), status: "rejected" };
    const cancelled: JoinRequest = { ...accepted, joinRequestId: joinRequestId("delete-cancelled"), userId: userId("cancelled-requester"), status: "cancelled" };
    for (const request of [pending, accepted, rejected, cancelled]) await db.add("joinRequests", toJoinRequestRecord(request));
    const terminalBefore = await Promise.all([accepted, rejected, cancelled].map(({ joinRequestId: id }) => db.get("joinRequests", id)));

    await atomic.deleteHousehold({
      householdId: house.householdId,
      actorId: leader,
      auditEvent: event("delete", house.householdId, leader, "deleted", "household", house.householdId),
      joinRequestAuditIdBase: auditEventId("phase-10-delete-closed-base"),
    });

    expect(await repositories.households.getById(house.householdId)).toMatchObject({ deletedAt: now, deletedByUserId: leader, code: house.code });
    expect(await repositories.joinRequests.getById(pending.joinRequestId)).toMatchObject({ status: "household-closed", resolvedAt: now, resolvedByUserId: leader });
    expect(await Promise.all([accepted, rejected, cancelled].map(({ joinRequestId: id }) => db.get("joinRequests", id)))).toEqual(terminalBefore);
    expect(await repositories.memberships.listByHousehold(house.householdId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: leader, status: "former", role: "leader" }),
      expect.objectContaining({ userId: member, status: "former", role: "member" }),
      expect.objectContaining({ userId: historicalLeader, status: "former", role: "leader" }),
    ]));
    expect(await repositories.memberships.findActiveByUser(leader)).toBeUndefined();
    expect(await repositories.memberships.findActiveByUser(member)).toBeUndefined();
    expect(await repositories.joinRequests.findPendingByUser(requester)).toBeUndefined();
    expect(await repositories.households.findByCode(house.code)).toMatchObject({ householdId: house.householdId, deletedAt: now });

    await atomic.createHousehold({
      household: { householdId: householdId("house-requester-next"), name: "Requester Next", code: "000000108", createdAt: now, updatedAt: now },
      leaderMembership: { householdId: householdId("house-requester-next"), userId: requester, status: "active", role: "leader" },
      auditEvent: event("requester-next", householdId("house-requester-next"), requester, "created", "household", "house-requester-next"),
    });
  });

  it("does not let ordinary transition APIs produce household-closed", async () => {
    const leader = userId("ordinary-leader");
    const requester = userId("ordinary-requester");
    const house = await createHouse("109", leader);
    const request: JoinRequest = { joinRequestId: joinRequestId("ordinary-pending"), householdId: house.householdId, userId: requester, status: "pending", createdAt: now };
    await db.add("joinRequests", toJoinRequestRecord(request));
    const forbidden = {
      joinRequestId: request.joinRequestId,
      actorId: leader,
      status: "household-closed",
      resolvedAt: now,
      auditEvent: event("ordinary-close", house.householdId, leader, "household-closed", "join-request", request.joinRequestId),
    } as unknown as Parameters<IndexedDbAtomicApplicationPersistence["transitionJoinRequest"]>[0];

    await expect(atomic.transitionJoinRequest(forbidden)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repositories.joinRequests.getById(request.joinRequestId)).toMatchObject({ status: "pending" });
  });

  it("rolls back the tombstone, membership, and Join Request writes when deletion aborts", async () => {
    const leader = userId("rollback-leader");
    const member = userId("rollback-member");
    const requester = userId("rollback-requester");
    const house = await createHouse("110", leader, [member]);
    const request: JoinRequest = { joinRequestId: joinRequestId("rollback-pending"), householdId: house.householdId, userId: requester, status: "pending", createdAt: now };
    await db.add("joinRequests", toJoinRequestRecord(request));
    const duplicate = event("rollback-duplicate", house.householdId, leader, "existing", "household", house.householdId);
    await db.add("auditEvents", toAuditRecord(duplicate));

    await expect(atomic.deleteHousehold({
      householdId: house.householdId,
      actorId: leader,
      auditEvent: { ...duplicate, action: "deleted" },
      joinRequestAuditIdBase: auditEventId("phase-10-rollback-closed-base"),
    })).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await repositories.households.getById(house.householdId)).not.toHaveProperty("deletedAt");
    expect(await repositories.memberships.get(house.householdId, leader)).toMatchObject({ status: "active" });
    expect(await repositories.memberships.get(house.householdId, member)).toMatchObject({ status: "active" });
    expect(await repositories.joinRequests.getById(request.joinRequestId)).toMatchObject({ status: "pending" });
  });

  it("blocks deletion for retained nonzero balances or Pending Settlements, but not Pending Join Requests", async () => {
    const leader = userId("delete-gate-leader");
    const member = userId("delete-gate-member");
    const former = userId("delete-gate-former");
    const requester = userId("delete-gate-requester");
    const house = await createHouse("112", leader, [member]);
    await repositories.memberships.create({ householdId: house.householdId, userId: former, status: "former", role: "member" });
    const financial = expense(house.householdId, leader, former, "former-balance-delete-gate");
    await db.add("expenses", toExpenseRecord(financial));
    const request: JoinRequest = { joinRequestId: joinRequestId("delete-gate-pending-join"), householdId: house.householdId, userId: requester, status: "pending", createdAt: now };
    await db.add("joinRequests", toJoinRequestRecord(request));
    const deleteInput = {
      householdId: house.householdId,
      actorId: leader,
      auditEvent: event("delete-gates", house.householdId, leader, "deleted", "household", house.householdId),
      joinRequestAuditIdBase: auditEventId("phase-10-delete-gates-base"),
    };

    await expect(atomic.deleteHousehold(deleteInput)).rejects.toMatchObject({ code: "HOUSEHOLD_STATE_CHANGED" });
    expect(await repositories.joinRequests.getById(request.joinRequestId)).toMatchObject({ status: "pending" });
    await repositories.expenses.markDeleted({ ...financial, updatedAt: now, deletedAt: now, deletedByUserId: leader });
    const pending = pendingSettlement(house.householdId, member, leader, "delete-gate-pending-settlement");
    await db.add("settlements", toSettlementRecord(pending));

    await expect(atomic.deleteHousehold(deleteInput)).rejects.toMatchObject({ code: "HOUSEHOLD_STATE_CHANGED" });
    expect(await repositories.households.getById(house.householdId)).not.toHaveProperty("deletedAt");
    await repositories.settlements.transitionPending({ ...pending, status: "cancelled", resolvedAt: now });

    await atomic.deleteHousehold(deleteInput);
    expect(await repositories.joinRequests.getById(request.joinRequestId)).toMatchObject({ status: "household-closed" });
  });

  it("revalidates Leader authority at commit time for both Accept and Reject", async () => {
    const formerLeader = userId("request-old-leader");
    const currentLeader = userId("request-new-leader");
    const acceptRequester = userId("stale-accept-requester");
    const rejectRequester = userId("stale-reject-requester");
    const house = await createHouse("113", formerLeader, [currentLeader]);
    const acceptRequest: JoinRequest = { joinRequestId: joinRequestId("stale-accept-request"), householdId: house.householdId, userId: acceptRequester, status: "pending", createdAt: now };
    const rejectRequest: JoinRequest = { joinRequestId: joinRequestId("stale-reject-request"), householdId: house.householdId, userId: rejectRequester, status: "pending", createdAt: now };
    await db.add("joinRequests", toJoinRequestRecord(acceptRequest));
    await db.add("joinRequests", toJoinRequestRecord(rejectRequest));
    await repositories.memberships.replace({ householdId: house.householdId, userId: formerLeader, status: "active", role: "member" });
    await repositories.memberships.replace({ householdId: house.householdId, userId: currentLeader, status: "active", role: "leader" });

    await expect(atomic.acceptJoinRequest({
      joinRequestId: acceptRequest.joinRequestId,
      actorId: formerLeader,
      resolvedAt: now,
      auditEvent: event("stale-accept", house.householdId, formerLeader, "accepted", "join-request", acceptRequest.joinRequestId),
    })).rejects.toMatchObject({ code: "HOUSEHOLD_STATE_CHANGED" });
    await expect(atomic.transitionJoinRequest({
      joinRequestId: rejectRequest.joinRequestId,
      actorId: formerLeader,
      status: "rejected",
      resolvedAt: now,
      auditEvent: event("stale-reject", house.householdId, formerLeader, "rejected", "join-request", rejectRequest.joinRequestId),
    })).rejects.toMatchObject({ code: "HOUSEHOLD_STATE_CHANGED" });

    expect(await repositories.joinRequests.getById(acceptRequest.joinRequestId)).toMatchObject({ status: "pending" });
    expect(await repositories.joinRequests.getById(rejectRequest.joinRequestId)).toMatchObject({ status: "pending" });
    expect(await repositories.memberships.findActiveByUser(acceptRequester)).toBeUndefined();
  });

  it("cannot create a newly Pending request after Household deletion serialized first", async () => {
    const leader = userId("request-race-leader");
    const requester = userId("request-race-requester");
    const house = await createHouse("114", leader);
    await atomic.deleteHousehold({
      householdId: house.householdId,
      actorId: leader,
      auditEvent: event("request-race-delete", house.householdId, leader, "deleted", "household", house.householdId),
      joinRequestAuditIdBase: auditEventId("phase-10-request-race-delete-base"),
    });
    const request: JoinRequest = {
      joinRequestId: joinRequestId("request-after-delete"),
      householdId: house.householdId,
      userId: requester,
      status: "pending",
      createdAt: now,
    };

    await expect(atomic.createJoinRequest({
      request,
      auditEvent: event("request-after-delete", house.householdId, requester, "requested", "join-request", request.joinRequestId),
    })).rejects.toMatchObject({ code: "HOUSEHOLD_STATE_CHANGED" });
    expect(await repositories.joinRequests.findPendingByUser(requester)).toBeUndefined();
  });

  it("preserves all financial, receipt, Card, profile, and prior audit records byte-for-byte", async () => {
    await seedLocalDatabase(db);
    const seededRepositories = new IndexedDbRepositories(db);
    const seededAtomic = new IndexedDbAtomicApplicationPersistence(db);
    for (const current of await seededRepositories.expenses.listHouseholdHistory(SEEDED_HOUSEHOLD_ID)) {
      await seededRepositories.expenses.markDeleted({ ...current, updatedAt: now, deletedAt: now, deletedByUserId: SEEDED_USER_IDS.raiyan });
    }
    const pending = (await seededRepositories.settlements.listByHousehold(SEEDED_HOUSEHOLD_ID))[0]!;
    await seededRepositories.settlements.transitionPending({ ...pending, status: "cancelled", resolvedAt: now });

    const protectedStores = [
      "expenses",
      "settlements",
      "receiptMetadata",
      "receiptBlobs",
      "cards",
      "expenseCardPrivateDetails",
      "userProfiles",
    ] as const;
    const before = new Map<string, unknown>();
    for (const store of protectedStores) before.set(store, await db.getAll(store));
    const priorAudits = await db.getAll("auditEvents");

    await seededAtomic.deleteHousehold({
      householdId: SEEDED_HOUSEHOLD_ID,
      actorId: SEEDED_USER_IDS.raiyan,
      auditEvent: event("seed-delete", SEEDED_HOUSEHOLD_ID, SEEDED_USER_IDS.raiyan, "deleted", "household", SEEDED_HOUSEHOLD_ID),
      joinRequestAuditIdBase: auditEventId("phase-10-seed-delete-closed-base"),
    });

    for (const store of protectedStores) expect(await db.getAll(store)).toEqual(before.get(store));
    const auditsAfter = await db.getAll("auditEvents");
    expect(auditsAfter.filter((audit) => priorAudits.some((prior) => prior.id === audit.id))).toEqual(priorAudits);
    expect(JSON.stringify(auditsAfter.slice(priorAudits.length))).not.toMatch(/Daily Debit|John Credit|card-|receipt|blob/i);
  });

  it("keeps V1 terminal Join Requests readable and does not rewrite them during deletion", async () => {
    const leader = userId("legacy-leader");
    const house = await createHouse("111", leader);
    const rawV1 = {
      recordVersion: 1 as const,
      id: "legacy-accepted",
      householdId: house.householdId,
      userId: "legacy-requester",
      status: "accepted" as const,
      createdAt: now,
      resolvedAt: now,
      resolvedByUserId: leader,
    };
    await db.add("joinRequests", rawV1);
    expect(await repositories.joinRequests.getById(joinRequestId(rawV1.id))).toMatchObject({ status: "accepted" });

    await atomic.deleteHousehold({
      householdId: house.householdId,
      actorId: leader,
      auditEvent: event("legacy-delete", house.householdId, leader, "deleted", "household", house.householdId),
      joinRequestAuditIdBase: auditEventId("phase-10-legacy-delete-base"),
    });
    expect(await db.get("joinRequests", rawV1.id)).toEqual(rawV1);
  });
});
