import { beforeEach, describe, expect, it } from "vitest";
import type { TablesDB } from "node-appwrite";
import { AppwriteCommandPersistence } from "./command-persistence.server";
import { TransactionFailure } from "./tx-errors.server";
import { runWithCommandEnvelope } from "./command-envelope.server";
import { createInMemoryTablesDB, InMemoryTablesReader } from "../reads/in-memory-tables-reader.helper";
import { guardRowId, membershipRowId } from "../ids";
import { canonicalIntentDigest, type IdempotencyDescriptor } from "@/application/idempotency/command-idempotency";
import { auditEventId, cardId, commandId, expenseCommentId, expenseId, householdId, joinRequestId, settlementId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import type { AuditEvent, Expense, ExpenseComment } from "@/domain/records/domain-records";
import { expenseDate } from "@/domain/dates/expense-date";
import { positivePoisha } from "@/domain/money/poisha";
import { allocateEqualSplit } from "@/domain/splits/equal-split";
import { expenseRelevantIntentDigest } from "@/application/expenses/backdated-expense-confirmation";
import type { SettlementRecord } from "@/domain/settlements/settlement-types";

const T0 = isoInstant("2026-08-26T08:00:00.000Z");
const T1 = isoInstant("2026-08-26T09:00:00.000Z");

const HH = householdId("h_house1");
const LEADER = userId("u_raiyan");
const JOHN = userId("u_john");
const SARAH = userId("u_sarah");
const DANA = userId("u_dana");
const ALEX = userId("u_alex");

let reader: InMemoryTablesReader;
let persistence: AppwriteCommandPersistence;

function seedGuard(kind: string, subject: string, owner?: string): void {
  const key = `${kind}:${subject}`;
  reader.seed("coordination_guards", [...reader.tables.get("coordination_guards") ?? [], { $id: guardRowId(key), logicalKey: key, ownerValue: owner ?? null, counter: 0, version: 0, createdAt: T0 }]);
}

function membershipRow(id: string, hh: string, user: string, role: string, status: string): Record<string, unknown> {
  return { $id: id, householdId: hh, userId: user, role, status, joinedAt: T0, leftAt: status === "former" ? T0 : null, statusChangedAt: T0, version: 1 };
}

function requestRow(id: string, user: string, status = "pending"): Record<string, unknown> {
  return { $id: id, householdId: String(HH), userId: user, status, createdAt: T0, resolvedAt: null, resolvedByUserId: null, requesterDisplayName: null };
}

function audit(id: string, actor: string, action: string): AuditEvent {
  return {
    auditEventId: auditEventId(id),
    householdId: HH,
    actorId: userId(actor),
    aggregateType: "membership",
    aggregateId: String(HH),
    action,
    occurredAt: T1,
    changedFields: ["status"],
  };
}

function descriptor(actor: string, commandIdValue: string, intentSeed: unknown): IdempotencyDescriptor {
  return {
    actorId: userId(actor),
    commandType: "create-household",
    commandId: commandId(commandIdValue),
    intentDigest: canonicalIntentDigest(intentSeed),
  };
}

function expenseRecord(id: string, payment: Expense["payment"] = { method: "cash" }): Expense {
  const allocations = allocateEqualSplit(positivePoisha(300), [LEADER, JOHN]);
  return {
    expenseId: expenseId(id), householdId: HH, creatorId: LEADER, payerId: LEADER,
    name: "Shared lunch", amount: positivePoisha(300), expenseDate: expenseDate("2026-08-26"),
    splitMethod: "equal", allocations, payment, revision: 1, createdAt: T1, updatedAt: T1,
  };
}

function expenseAudit(id: string, action = "created", instant = T1): AuditEvent {
  return {
    auditEventId: auditEventId(`a_${id}_${action}`), householdId: HH, actorId: LEADER,
    aggregateType: "expense", aggregateId: id, action, occurredAt: instant, changedFields: ["expense"],
  };
}

function pendingSettlement(id = "s_pending"): SettlementRecord {
  const recommendation = { householdId: HH, senderId: JOHN, receiverId: LEADER, amount: positivePoisha(150) };
  return {
    settlementId: settlementId(id), ...recommendation, originatingRecommendation: recommendation,
    status: "pending", createdAt: T1,
  };
}

function settlementAudit(id: string, actor = JOHN, action = "created-pending", instant = T1): AuditEvent {
  return {
    auditEventId: auditEventId(`a_${id}_${action}`), householdId: HH, actorId: actor,
    aggregateType: "settlement", aggregateId: id, action, occurredAt: instant, changedFields: ["status", "amount"],
  };
}

beforeEach(() => {
  reader = new InMemoryTablesReader();
  persistence = new AppwriteCommandPersistence(createInMemoryTablesDB(reader).tablesDB as unknown as TablesDB);
  reader.seed("households", [{ $id: String(HH), name: "Raiyan House", code: "012345678", version: 1, createdAt: T0, updatedAt: T0, deletedAt: null, deletedByUserId: null }]);
  reader.seed("memberships", [
    membershipRow(membershipRowId(String(HH), String(LEADER)), String(HH), String(LEADER), "leader", "active"),
    membershipRow(membershipRowId(String(HH), String(JOHN)), String(HH), String(JOHN), "member", "active"),
    membershipRow(membershipRowId(String(HH), String(SARAH)), String(HH), String(SARAH), "member", "active"),
  ]);
  reader.seed("join_requests", [requestRow("j_req1", String(ALEX))]);
  reader.seed("expenses", []);
  reader.seed("expense_comments", []);
  reader.seed("settlements", []);
  reader.seed("cards", []);
  reader.seed("expense_card_private_details", []);
  reader.seed("command_outcomes", []);
  reader.seed("profiles", [
    { $id: String(LEADER), displayName: "Raiyan", version: 3, createdAt: T0, updatedAt: T0 },
    { $id: String(JOHN), displayName: "John", version: 1, createdAt: T0, updatedAt: T0 },
  ]);
  reader.seed("coordination_guards", []);
  seedGuard("active-membership", String(LEADER), String(LEADER));
  seedGuard("active-membership", String(JOHN), String(JOHN));
  seedGuard("active-membership", String(SARAH), String(SARAH));
  seedGuard("active-leader", String(HH), String(LEADER));
  seedGuard("financial", String(HH));
  seedGuard("pending-join", String(ALEX), String(ALEX));
});

async function codesOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).name;
  }
}

describe("trusted Appwrite command kernel", () => {
  describe("v1.1 Profile Display Name command", () => {
    const profileDescriptor = (id: string, displayName: string): IdempotencyDescriptor => ({
      actorId: LEADER,
      commandType: "update-profile-display-name",
      commandId: commandId(id),
      intentDigest: canonicalIntentDigest({ displayName }),
    });

    it("updates only the actor Profile with OCC and replays without another increment", async () => {
      const membershipsBefore = structuredClone(await reader.listRows("memberships"));
      const requestsBefore = structuredClone(await reader.listRows("join_requests"));
      const descriptor = profileDescriptor("profile-rename", "Raiyan Updated");
      const input = { actorId: LEADER, displayName: "Raiyan Updated", expectedVersion: 3, occurredAt: T1, idempotency: descriptor };
      await persistence.updateCurrentProfile(input);
      expect(await reader.getRow("profiles", String(LEADER))).toMatchObject({ displayName: "Raiyan Updated", version: 4, createdAt: T0, updatedAt: T1 });
      expect(await reader.getRow("profiles", String(JOHN))).toMatchObject({ displayName: "John", version: 1 });
      expect(await reader.listRows("memberships")).toEqual(membershipsBefore);
      expect(await reader.listRows("join_requests")).toEqual(requestsBefore);
      expect(await reader.listRows("command_outcomes")).toHaveLength(1);

      await persistence.updateCurrentProfile(input);
      expect(await reader.getRow("profiles", String(LEADER))).toMatchObject({ displayName: "Raiyan Updated", version: 4 });
      expect(await reader.listRows("command_outcomes")).toHaveLength(1);
      await expect(persistence.updateCurrentProfile({
        ...input,
        displayName: "Changed intent",
        expectedVersion: 4,
        idempotency: profileDescriptor("profile-rename", "Changed intent"),
      })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    });

    it("rejects stale versions with zero write and treats an unchanged name as a write-free no-op", async () => {
      const before = structuredClone(await reader.getRow("profiles", String(LEADER)));
      await expect(persistence.updateCurrentProfile({
        actorId: LEADER,
        displayName: "Stale Name",
        expectedVersion: 2,
        occurredAt: T1,
        idempotency: profileDescriptor("profile-stale", "Stale Name"),
      })).rejects.toMatchObject({ code: "PROFILE_VERSION_CONFLICT" });
      expect(await reader.getRow("profiles", String(LEADER))).toEqual(before);
      expect(await reader.listRows("command_outcomes")).toEqual([]);

      await persistence.updateCurrentProfile({
        actorId: LEADER,
        displayName: "Raiyan",
        expectedVersion: 1,
        occurredAt: T1,
        idempotency: profileDescriptor("profile-noop", "Raiyan"),
      });
      expect(await reader.getRow("profiles", String(LEADER))).toEqual(before);
      expect(await reader.listRows("command_outcomes")).toEqual([]);
    });

    it("rejects an over-limit Display Name at the authoritative persistence boundary", async () => {
      const displayName = "N".repeat(21);
      await expect(persistence.updateCurrentProfile({
        actorId: LEADER,
        displayName,
        expectedVersion: 3,
        occurredAt: T1,
        idempotency: profileDescriptor("profile-too-long", displayName),
      })).rejects.toMatchObject({
        code: "INVALID_INPUT",
        message: "Display name must be 20 characters or fewer.",
      });
      expect(await reader.getRow("profiles", String(LEADER))).toMatchObject({ displayName: "Raiyan", version: 3 });
      expect(await reader.listRows("command_outcomes")).toEqual([]);
    });
  });

  describe("protected creates", () => {
    it("creates a household atomically with leader membership, guards, audit, and outcome", async () => {
      const newHouseholdDescriptor = descriptor(String(DANA), "k_cmd_new", { name: "Alex House", code: "999999999" });
      const resourceId = await persistence.createHousehold({
        household: { householdId: householdId("h_alex"), name: "Alex House", code: "999999999", createdAt: T1, updatedAt: T1 },
        leaderMembership: { householdId: householdId("h_alex"), userId: DANA, role: "leader", status: "active" },
        idempotency: newHouseholdDescriptor,
        auditEvent: audit("a_create", String(DANA), "created"),
      });
      expect(resourceId).toBe("h_alex");
      const created = await reader.getRow("households", "h_alex");
      expect(created?.name).toBe("Alex House");
      const membershipList = await reader.listRows("memberships");
      expect(membershipList.some((row) => row.userId === DANA && row.householdId === "h_alex" && row.role === "leader")).toBe(true);
      const guards = await reader.listRows("coordination_guards");
      expect(guards.some((row) => row.logicalKey === "active-leader:h_alex")).toBe(true);
      expect(guards.some((row) => row.logicalKey === "financial:h_alex")).toBe(true);
      const outcomes = await reader.listRows("command_outcomes");
      expect(outcomes.some((row) => row.resourceId === "h_alex")).toBe(true);
    });

    it("rejects duplicate household codes with zero staged writes", async () => {
      const before = await reader.listRows("coordination_guards");
      const code = await codesOf(() => persistence.createHousehold({
        household: { householdId: householdId("h_dup"), name: "Dup", code: "012345678", createdAt: T1, updatedAt: T1 },
        leaderMembership: { householdId: householdId("h_dup"), userId: ALEX, role: "leader", status: "active" },
        idempotency: descriptor(String(ALEX), "k_cmd_dup", {}),
        auditEvent: audit("a_dup", String(ALEX), "created"),
      }));
      expect(code).toBe("CONFLICT");
      const after = await reader.listRows("coordination_guards");
      expect(after.length).toBe(before.length);
      expect(await reader.getRow("households", "h_dup")).toBeUndefined();
    });

    it("returns the original outcome on replay and rejects reused keys with different intents", async () => {
      const sharedIntent = { name: "Dana House", code: "999999999" };
      const first = descriptor(String(DANA), "k_cmd_replay", sharedIntent);
      const resourceId = await persistence.createHousehold({
        household: { householdId: householdId("h_replay"), name: "Dana House", code: "999999999", createdAt: T1, updatedAt: T1 },
        leaderMembership: { householdId: householdId("h_replay"), userId: DANA, role: "leader", status: "active" },
        idempotency: first,
        auditEvent: audit("a_replay", String(ALEX), "created"),
      });
      expect(resourceId).toBe("h_replay");

      // Same key + same intent replays without a second write.
      const replayed = await persistence.createHousehold({
        household: { householdId: householdId("h_replay"), name: "Dana House", code: "999999999", createdAt: T1, updatedAt: T1 },
        leaderMembership: { householdId: householdId("h_replay"), userId: DANA, role: "leader", status: "active" },
        idempotency: first,
        auditEvent: audit("a_replay2", String(ALEX), "created"),
      });
      expect(replayed).toBe("h_replay");

      // Same key + different intent fails closed.
      const reused = descriptor(String(DANA), "k_cmd_replay", { name: "Different", code: "888888888" });
      await expect(persistence.createHousehold({
        household: { householdId: householdId("h_other"), name: "Different", code: "888888888", createdAt: T1, updatedAt: T1 },
        leaderMembership: { householdId: householdId("h_other"), userId: DANA, role: "leader", status: "active" },
        idempotency: reused,
        auditEvent: audit("a_other", String(ALEX), "created"),
      })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    });

    it("blocks a fourth pending request path when the actor already holds an active membership", async () => {
      const code = await codesOf(() => persistence.createJoinRequest({
        request: { joinRequestId: joinRequestId("j_x"), householdId: HH, userId: JOHN, status: "pending", createdAt: T1 },
        idempotency: {
          actorId: JOHN,
          commandType: "send-join-request",
          commandId: commandId("k_jr_x"),
          intentDigest: canonicalIntentDigest({}),
        },
        auditEvent: audit("a_jr_x", String(JOHN), "requested"),
      }));
      expect(code).toBe("CONFLICT");
    });
  });

  describe("join-request lifecycle", () => {
    it("accepts a pending request inside frozen gates with exactly five staged writes", async () => {
      await persistence.acceptJoinRequest({
        joinRequestId: joinRequestId("j_req1"),
        actorId: LEADER,
        resolvedAt: T1,
        auditEvent: audit("a_accept", String(LEADER), "accepted"),
      });
      const request = await reader.getRow("join_requests", "j_req1");
      expect(request?.status).toBe("accepted");
      expect(request?.resolvedByUserId).toBe(String(LEADER));
      const membershipList = await reader.listRows("memberships");
      expect(membershipList.some((row) => row.userId === ALEX && row.status === "active" && row.role === "member")).toBe(true);
      const guards = await reader.listRows("coordination_guards");
      expect(guards.some((row) => row.logicalKey === "pending-join:u_alex")).toBe(false);
      expect(guards.some((row) => row.logicalKey === "active-membership:u_alex")).toBe(true);
    });

    it("blocks acceptance when the requester is already active elsewhere", async () => {
      // Promote alex to a member of a DIFFERENT household so acceptance is gated purely by capacity.
      reader.seed("memberships", [
        ...reader.tables.get("memberships") ?? [],
        { $id: "m-other", householdId: "h_elsewhere", userId: ALEX, role: "leader", status: "active", joinedAt: T0, leftAt: null, statusChangedAt: T0, version: 1 },
      ]);
      const code = await codesOf(() => persistence.acceptJoinRequest({
        joinRequestId: joinRequestId("j_req1"),
        actorId: LEADER,
        resolvedAt: T1,
        auditEvent: audit("a_cap", String(LEADER), "accepted"),
      }));
      expect(code).toBe("HOUSEHOLD_STATE_CHANGED");
    });

    it("rejects acceptance when the requester is already active elsewhere", async () => {
      // Fill the fourth seat with a fourth account so the cap is not the blocker.
      const DANA = userId("u_dana");
      reader.seed("memberships", [
        ...(reader.tables.get("memberships") ?? []).filter((row) => row.$id !== "j-seed"),
        membershipRow(membershipRowId(String(HH), String(DANA)), String(HH), String(DANA), "member", "active") as unknown as Record<string, unknown>,
      ]);
      // Now h1 has 4 active members; a NEW pending request must be capped on accept.
      reader.seed("join_requests", [requestRow("j_new", String(ALEX))]);
      seedGuard("pending-join", String(ALEX), String(ALEX));
      const failure = await persistence.acceptJoinRequest({
        joinRequestId: joinRequestId("j_new"),
        actorId: LEADER,
        resolvedAt: T1,
        auditEvent: audit("a_new", String(LEADER), "accepted"),
      }).then(() => null, (error) => error as Error & { code?: string });
      expect(failure?.code).toBe("CONFLICT");
      expect(failure?.message).toContain("HOUSEHOLD_MEMBER_LIMIT_REACHED");
    });

    it("permits only the requester to cancel and only the leader to reject", async () => {
      const cancelByOther = await codesOf(() => persistence.transitionJoinRequest({
        joinRequestId: joinRequestId("j_req1"),
        actorId: JOHN,
        status: "cancelled",
        resolvedAt: T1,
        auditEvent: audit("a_c1", String(JOHN), "cancelled"),
      }));
      expect(cancelByOther).toBe("HOUSEHOLD_STATE_CHANGED");

      const rejectByMember = await codesOf(() => persistence.transitionJoinRequest({
        joinRequestId: joinRequestId("j_req1"),
        actorId: JOHN,
        status: "rejected",
        resolvedAt: T1,
        auditEvent: audit("a_r1", String(JOHN), "rejected"),
      }));
      expect(rejectByMember).toBe("NOT_FOUND");

      await persistence.transitionJoinRequest({
        joinRequestId: joinRequestId("j_req1"),
        actorId: ALEX,
        status: "cancelled",
        resolvedAt: T1,
        auditEvent: audit("a_c2", String(ALEX), "cancelled"),
      });
      expect((await reader.getRow("join_requests", "j_req1"))?.status).toBe("cancelled");
    });
  });

  describe("rename / transfer / leave / remove", () => {
    it("renames as leader only and treats unchanged names as no-ops", async () => {
      await persistence.renameHousehold({ householdId: HH, actorId: LEADER, name: "Renamed House", occurredAt: T1, auditEvent: audit("a_ren", String(LEADER), "renamed") });
      expect((await reader.getRow("households", String(HH)))?.name).toBe("Renamed House");

      const before = await reader.listRows("audit_events");
      await persistence.renameHousehold({ householdId: HH, actorId: LEADER, name: "Renamed House", occurredAt: T1, auditEvent: audit("a_ren2", String(LEADER), "renamed") });
      expect((await reader.listRows("audit_events")).length).toBe(before.length);

      const byMember = await codesOf(() => persistence.renameHousehold({ householdId: HH, actorId: JOHN, name: "X", occurredAt: T1, auditEvent: audit("a_ren3", String(JOHN), "renamed") }));
      expect(byMember).toBe("NOT_FOUND");
    });

    it("transfers leadership atomically and preserves exactly-one-leader", async () => {
      await persistence.transferLeadership({ householdId: HH, actorId: LEADER, targetId: JOHN, auditEvent: audit("a_tx", String(LEADER), "leadership-transferred") });
      const memberships = await reader.listRows("memberships");
      expect(memberships.find((row) => row.userId === LEADER)?.role).toBe("member");
      expect(memberships.find((row) => row.userId === JOHN)?.role).toBe("leader");
      const guards = await reader.listRows("coordination_guards");
      expect(guards.find((row) => row.logicalKey === "active-leader:h_house1")?.ownerValue).toBe(String(JOHN));

      // The old leader can no longer transfer.
      const stale = await codesOf(() => persistence.transferLeadership({ householdId: HH, actorId: LEADER, targetId: SARAH, auditEvent: audit("a_tx2", String(LEADER), "leadership-transferred") }));
      expect(["NOT_FOUND", "HOUSEHOLD_STATE_CHANGED"]).toContain(stale);
    });

    it("lets a settled-zero member leave and blocks leaders or unsettled members", async () => {
      await persistence.leaveHousehold({ householdId: HH, actorId: JOHN, auditEvent: audit("a_leave", String(JOHN), "left") });
      const john = (await reader.listRows("memberships")).find((row) => row.userId === JOHN);
      expect(john?.status).toBe("former");
      const guards = await reader.listRows("coordination_guards");
      expect(guards.some((row) => row.logicalKey === "active-membership:u_john")).toBe(false);

      const leaderLeave = await codesOf(() => persistence.leaveHousehold({ householdId: HH, actorId: LEADER, auditEvent: audit("a_l2", String(LEADER), "left") }));
      expect(leaderLeave).toBe("CONFLICT");

      // Give sarah an unbalanced expense share, then attempt to leave.
      reader.seed("expenses", [{
        $id: "e_unbal", householdId: String(HH), expenseDate: "2026-08-01", amountPoisha: "30000",
        payerId: String(LEADER), createdBy: String(LEADER), splitMethod: "equal", name: "Groceries",
        paymentMethod: "cash", paymentRefJson: "{}",
        allocationsJson: JSON.stringify([
          { participantId: String(JOHN), sharePoisha: "10000" },
          { participantId: String(LEADER), sharePoisha: "10000" },
          { participantId: String(SARAH), sharePoisha: "10000" },
        ]),
        percentageEntriesJson: null, revision: 1, createdAt: T0, updatedAt: T0, deletedAt: null, deletedByUserId: null,
      }]);
      const unsettled = await codesOf(() => persistence.leaveHousehold({ householdId: HH, actorId: SARAH, auditEvent: audit("a_l3", String(SARAH), "left") }));
      expect(unsettled).toBe("CONFLICT");
    });

    it("removes only active non-leader members with cleared finances", async () => {
      await persistence.removeHouseholdMember({ householdId: HH, actorId: LEADER, targetId: JOHN, auditEvent: audit("a_rm", String(LEADER), "removed") });
      expect((await reader.listRows("memberships")).find((row) => row.userId === JOHN)?.status).toBe("former");

      const removeLeader = await codesOf(() => persistence.removeHouseholdMember({ householdId: HH, actorId: LEADER, targetId: LEADER, auditEvent: audit("a_rm2", String(LEADER), "removed") }));
      expect(removeLeader).toBe("CONFLICT");
    });
  });

  describe("household deletion", () => {
    it("tombstones atomically, converts members, closes requests, releases guards, and measures operations", async () => {
      const runDelete = () => runWithCommandEnvelope(
        { commandType: "delete-household", commandId: "k_del1", intentSeed: { householdId: String(HH) } },
        () => persistence.deleteHousehold({
          householdId: HH,
          actorId: LEADER,
          auditEvent: audit("a_del", String(LEADER), "deleted"),
          joinRequestAuditIdBase: auditEventId("a_deljr"),
        }),
      );
      await runDelete();
      const tombstoned = await reader.getRow("households", String(HH));
      expect(tombstoned?.deletedAt).toBe(T1);
      expect(tombstoned?.deletedByUserId).toBe(String(LEADER));
      const memberships = await reader.listRows("memberships");
      expect(memberships.filter((row) => row.householdId === String(HH)).every((row) => row.status === "former")).toBe(true);
      expect((await reader.getRow("join_requests", "j_req1"))?.status).toBe("household-closed");
      const guards = await reader.listRows("coordination_guards");
      expect(guards.filter((row) => String(row.logicalKey).includes(String(HH))).length).toBe(0);
      expect(guards.some((row) => row.logicalKey === "pending-join:u_alex")).toBe(false);
      // Enveloped production delivery adds the idempotency outcome row:
      // 4 + 2M + 3J + 1 outcome = 14 at M=3/J=1. Certified bound <= 16.
      expect(persistence.lastDeleteStagedOperations).toBe(14);

      // Lost-response retry with the SAME command key replays success without
      // any additional staged mutation or duplicate lifecycle effect. The
      // counter retains the first (and only) real transaction's total.
      await runDelete();
      expect(persistence.lastDeleteStagedOperations).toBe(14);
      const auditsAfterReplay = await reader.listRows("audit_events");
      expect(auditsAfterReplay.filter((row) => row.action === "deleted").length).toBe(1);
      expect((await reader.getRow("households", String(HH)))?.deletedAt).toBe(T1);
    });

    it("rolls back completely when any balance is non-zero", async () => {
      reader.seed("expenses", [{
        $id: "e_unbal", householdId: String(HH), expenseDate: "2026-08-01", amountPoisha: "30000",
        payerId: String(LEADER), createdBy: String(LEADER), splitMethod: "equal", name: "Groceries",
        paymentMethod: "cash", paymentRefJson: "{}",
        allocationsJson: JSON.stringify([{ participantId: String(SARAH), sharePoisha: "30000" }]),
        percentageEntriesJson: null, revision: 1, createdAt: T0, updatedAt: T0, deletedAt: null, deletedByUserId: null,
      }]);
      const code = await codesOf(() => persistence.deleteHousehold({
        householdId: HH,
        actorId: LEADER,
        auditEvent: audit("a_del2", String(LEADER), "deleted"),
        joinRequestAuditIdBase: auditEventId("a_deljr2"),
      }));
      expect(code).toBe("CONFLICT");
      expect((await reader.getRow("households", String(HH)))?.deletedAt).toBeNull();
      expect((await reader.getRow("join_requests", "j_req1"))?.status).toBe("pending");
      expect(persistence.lastDeleteStagedOperations).toBe(0);
    });

    it("forces commit-time conflicts back to the client without partial writes", async () => {
      reader.conflictOnCommit.add(`households/${String(HH)}`);
      const failure = await persistence.renameHousehold({ householdId: HH, actorId: LEADER, name: "Conflict House", occurredAt: T1, auditEvent: audit("a_conf", String(LEADER), "renamed") }).then(() => null, (error) => error as TransactionFailure);
      expect(failure).not.toBeNull();
      expect(failure?.kind).toBe("conflict");
      expect((await reader.getRow("households", String(HH)))?.name).toBe("Raiyan House");
    });

    it("replays a lost-response accept and rejects changed-intent reuse", async () => {
      const runAccept = (name: string) => runWithCommandEnvelope(
        { commandType: "accept-join-request", commandId: "k_acc1", intentSeed: { joinRequestId: String(joinRequestId("j_req1")) } },
        () => persistence.acceptJoinRequest({
          joinRequestId: joinRequestId("j_req1"),
          actorId: LEADER,
          resolvedAt: T1,
          auditEvent: audit(name, String(LEADER), "accepted"),
        }),
      );
      await runAccept("a_acc1");
      const auditsAfterFirst = (await reader.listRows("audit_events")).length;

      // Identical retry: replayed, no duplicate membership mutation or audit.
      await runAccept("a_acc1");
      expect((await reader.listRows("audit_events")).length).toBe(auditsAfterFirst);
      expect((await reader.listRows("memberships")).filter((row) => row.userId === ALEX && row.status === "active").length).toBe(1);

      // Same commandId + changed intent (different target) fails closed.
      reader.seed("join_requests", [requestRow("j_req2", String(ALEX))]);
      seedGuard("pending-join", String(ALEX), String(ALEX));
      const failure = await runWithCommandEnvelope(
        { commandType: "accept-join-request", commandId: "k_acc1", intentSeed: { joinRequestId: String(joinRequestId("j_req2")) } },
        () => persistence.acceptJoinRequest({
          joinRequestId: joinRequestId("j_req2"),
          actorId: LEADER,
          resolvedAt: T1,
          auditEvent: audit("a_acc2", String(LEADER), "accepted"),
        }),
      ).then(() => null, (error) => (error as Error & { code?: string }));
      expect(failure?.code).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("keeps non-enveloped transitions free of outcome rows", async () => {
      await persistence.leaveHousehold({ householdId: HH, actorId: JOHN, auditEvent: audit("a_leave_ne", String(JOHN), "left") });
      expect(await reader.listRows("command_outcomes")).toEqual([]);
    });

    it("fails closed when staging would exceed the certified operation bound", async () => {
      // The kernel hard-stops past 100 staged operations (provider parity).
      expect(() => {
        const txId = reader.createTransaction().$id;
        for (let index = 0; index < 101; index += 1) {
          reader.stageCreateRow("hft", "coordination_guards", `bound-${index}`, { logicalKey: `bound-${index}` }, txId);
        }
      }).toThrow();
    });
  });

  describe("R3B owner-private Card commands", () => {
    const cardDescriptor = (id: string, name = "Travel") => ({
      actorId: LEADER,
      commandType: "create-card" as const,
      commandId: commandId(id),
      intentDigest: canonicalIntentDigest({ name, type: "debit", colorId: "red" }),
    });

    it("creates a Card with its guard and outcome but no Household audit", async () => {
      const resourceId = await persistence.createCard({
        card: { cardId: cardId("c_travel"), ownerId: LEADER, name: "Travel", type: "debit", colorId: "red", createdAt: T0, updatedAt: T0 },
        idempotency: cardDescriptor("k_card_create"),
      });
      expect(resourceId).toBe("c_travel");
      expect(await reader.getRow("cards", "c_travel")).toMatchObject({ ownerId: LEADER, status: "active", version: 1 });
      expect((await reader.listRows("coordination_guards")).some((row) => row.logicalKey === "card:c_travel")).toBe(true);
      expect(await reader.listRows("audit_events")).toEqual([]);
      expect(await reader.listRows("command_outcomes")).toHaveLength(1);
      expect(persistence.lastR3StagedOperations.createCard).toBe(3);

      await expect(persistence.createCard({
        card: { cardId: cardId("c_other"), ownerId: LEADER, name: "Changed", type: "debit", colorId: "red", createdAt: T0, updatedAt: T0 },
        idempotency: cardDescriptor("k_card_create", "Changed"),
      })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    });

    it("edits with OCC, Card-guard serialization, replay, and changed-intent protection", async () => {
      await persistence.createCard({
        card: { cardId: cardId("c_edit"), ownerId: LEADER, name: "Original", type: "debit", colorId: "red", createdAt: T0, updatedAt: T0 },
        idempotency: cardDescriptor("k_card_seed", "Original"),
      });
      const run = (name: string) => runWithCommandEnvelope(
        { commandType: "edit-card", commandId: "k_card_edit", intentSeed: { cardId: "c_edit", name, type: "credit", colorId: "blue" } },
        () => persistence.updateCard({
          card: { cardId: cardId("c_edit"), ownerId: LEADER, name, type: "credit", colorId: "blue", createdAt: T0, updatedAt: T1 },
          expectedUpdatedAt: T0,
        }),
      );
      await run("Updated");
      expect(await reader.getRow("cards", "c_edit")).toMatchObject({ name: "Updated", type: "credit", design: "blue", version: 2 });
      expect(persistence.lastR3StagedOperations.editCard).toBe(3);
      await run("Updated");
      expect((await reader.listRows("command_outcomes")).filter((row) => row.commandType === "edit-card")).toHaveLength(1);
      await expect(run("Changed intent")).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

      await expect(persistence.updateCard({
        card: { cardId: cardId("c_edit"), ownerId: JOHN, name: "Probe", type: "credit", colorId: "blue", createdAt: T0, updatedAt: T1 },
        expectedUpdatedAt: T1,
      })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("deletes when unreferenced, archives when referenced, and refuses stale Delete consent", async () => {
      const seed = async (id: string) => persistence.createCard({
        card: { cardId: cardId(id), ownerId: LEADER, name: id, type: "debit", colorId: "red", createdAt: T0, updatedAt: T0 },
        idempotency: cardDescriptor(`k_${id}`, id),
      });
      await seed("c_delete");
      const deleted = await runWithCommandEnvelope(
        { commandType: "remove-card", commandId: "k_remove_delete", intentSeed: { cardId: "c_delete", expectedAction: "delete" } },
        () => persistence.removeCard({ cardId: cardId("c_delete"), ownerId: LEADER, expectedAction: "delete", occurredAt: T1 }),
      );
      expect(deleted).toBe("deleted");
      expect(await reader.getRow("cards", "c_delete")).toBeUndefined();

      await seed("c_archive");
      reader.seed("expense_card_private_details", [{ $id: "e_ref", ownerId: LEADER, cardId: "c_archive", cardName: "c_archive", snapshotJson: JSON.stringify({ cardType: "debit", colorId: "red" }), createdAt: T0 }]);
      await expect(runWithCommandEnvelope(
        { commandType: "remove-card", commandId: "k_remove_stale", intentSeed: { cardId: "c_archive", expectedAction: "delete" } },
        () => persistence.removeCard({ cardId: cardId("c_archive"), ownerId: LEADER, expectedAction: "delete", occurredAt: T1 }),
      )).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await reader.getRow("cards", "c_archive"))?.status).toBe("active");

      const archived = await runWithCommandEnvelope(
        { commandType: "remove-card", commandId: "k_remove_archive", intentSeed: { cardId: "c_archive", expectedAction: "archive" } },
        () => persistence.removeCard({ cardId: cardId("c_archive"), ownerId: LEADER, expectedAction: "archive", occurredAt: T1 }),
      );
      expect(archived).toBe("archived");
      expect(await reader.getRow("cards", "c_archive")).toMatchObject({ status: "archived", archivedAt: T1, version: 2 });
      expect(await reader.listRows("audit_events")).toEqual([]);
      expect(persistence.lastR3StagedOperations.removeCard).toBe(3);
    });
  });

  describe("R3C/R3D Expense commands", () => {
    const expenseDescriptor = (id: string, intent: unknown = { expenseId: id }): IdempotencyDescriptor => ({
      actorId: LEADER,
      commandType: "create-expense",
      commandId: commandId(`k_${id}`),
      intentDigest: canonicalIntentDigest(intent),
    });

    it("creates exact Cash and Card Expenses with measured atomic write counts", async () => {
      const cash = expenseRecord("e_cash");
      const cashId = await persistence.createExpense({
        expense: cash, actorId: LEADER, commandId: expenseDescriptor("e_cash").commandId,
        receipts: [], auditEvent: expenseAudit("e_cash"), idempotency: expenseDescriptor("e_cash"),
      });
      expect(cashId).toBe("e_cash");
      expect(await reader.getRow("expenses", "e_cash")).toMatchObject({ amountPoisha: 300, revision: 1, paymentMethod: "cash" });
      expect(persistence.lastR3StagedOperations.createExpense).toBe(4);

      reader.seed("cards", [{
        $id: "c_pay", ownerId: LEADER, name: "Private Leader Card", design: "red", type: "debit",
        status: "active", archivedAt: null, version: 1, createdAt: T0, updatedAt: T0,
      }]);
      seedGuard("card", "c_pay", String(LEADER));
      const cardExpense = expenseRecord("e_card", { method: "card", cardReference: "private:e_card" });
      await persistence.createExpense({
        expense: cardExpense, actorId: LEADER, commandId: expenseDescriptor("e_card").commandId,
        selectedCardId: cardId("c_pay"), receipts: [], auditEvent: expenseAudit("e_card"), idempotency: expenseDescriptor("e_card"),
      });
      expect(await reader.getRow("expense_card_private_details", "e_card")).toMatchObject({
        ownerId: LEADER, cardId: "c_pay", cardName: "Private Leader Card",
      });
      expect(String((await reader.getRow("expense_card_private_details", "e_card"))?.snapshotJson)).not.toContain("Private Leader Card");
      expect(persistence.lastR3StagedOperations.createExpense).toBe(6);
    });

    it("measures the worst-case Card-switch edit and Card-linked soft delete", async () => {
      reader.seed("cards", [
        {
          $id: "c_old", ownerId: LEADER, name: "Old Card", design: "red", type: "debit",
          status: "active", archivedAt: null, version: 1, createdAt: T0, updatedAt: T0,
        },
        {
          $id: "c_new", ownerId: LEADER, name: "New Card", design: "blue", type: "credit",
          status: "active", archivedAt: null, version: 1, createdAt: T0, updatedAt: T0,
        },
      ]);
      seedGuard("card", "c_old", String(LEADER));
      seedGuard("card", "c_new", String(LEADER));
      const original = expenseRecord("e_switch", { method: "card", cardReference: "private:e_switch" });
      await persistence.createExpense({
        expense: original, actorId: LEADER, commandId: expenseDescriptor("e_switch").commandId,
        selectedCardId: cardId("c_old"), receipts: [], auditEvent: expenseAudit("e_switch"), idempotency: expenseDescriptor("e_switch"),
      });

      const editedAt = isoInstant("2026-08-26T10:00:00.000Z");
      const switched: Expense = { ...original, revision: 2, updatedAt: editedAt };
      await runWithCommandEnvelope(
        { commandType: "edit-expense", commandId: "k_switch", intentSeed: { expenseId: "e_switch", cardId: "c_new" } },
        () => persistence.editExpense({
          expectedExpenseId: original.expenseId, actorId: LEADER, commandId: commandId("k_switch"),
          expense: switched, selectedCardId: cardId("c_new"), expectedRevision: 1,
          backdatedConfirmationApplicable: false,
          auditEvents: [{
            ...expenseAudit("e_switch", "edited", editedAt),
            auditEventId: auditEventId("a_e_switch_card_edited"),
          }],
        }),
      );
      expect(await reader.getRow("expense_card_private_details", "e_switch")).toMatchObject({ cardId: "c_new", cardName: "New Card" });
      expect(persistence.lastR3StagedOperations.editExpense).toBe(7);

      const deletedAt = isoInstant("2026-08-26T11:00:00.000Z");
      const deleted: Expense = {
        ...switched, revision: 3, updatedAt: deletedAt, deletedAt, deletedByUserId: LEADER,
      };
      await runWithCommandEnvelope(
        { commandType: "delete-expense", commandId: "k_delete_switch", intentSeed: { expenseId: "e_switch", expectedRevision: 2 } },
        () => persistence.editExpense({
          expectedExpenseId: original.expenseId, actorId: LEADER, commandId: commandId("k_delete_switch"),
          expense: deleted, expectedRevision: 2, backdatedConfirmationApplicable: false,
          auditEvents: [{
            ...expenseAudit("e_switch", "deleted", deletedAt),
            auditEventId: auditEventId("a_e_switch_deleted"),
          }],
        }),
      );
      expect(await reader.getRow("expenses", "e_switch")).toMatchObject({ revision: 3, deletedAt });
      expect(persistence.lastR3StagedOperations.deleteExpense).toBe(5);
    });

    it("rejects forged/archived Card selection, future dates, and R4 Receipt payloads with rollback", async () => {
      reader.seed("cards", [{
        $id: "c_foreign", ownerId: JOHN, name: "John private", design: "blue", type: "credit",
        status: "active", archivedAt: null, version: 1, createdAt: T0, updatedAt: T0,
      }]);
      const forged = expenseRecord("e_forged", { method: "card", cardReference: "private:e_forged" });
      await expect(persistence.createExpense({
        expense: forged, actorId: LEADER, commandId: expenseDescriptor("e_forged").commandId,
        selectedCardId: cardId("c_foreign"), receipts: [], auditEvent: expenseAudit("e_forged"), idempotency: expenseDescriptor("e_forged"),
      })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await reader.getRow("expenses", "e_forged")).toBeUndefined();

      const future = { ...expenseRecord("e_future"), expenseDate: expenseDate("2026-08-27") };
      await expect(persistence.createExpense({
        expense: future, actorId: LEADER, commandId: expenseDescriptor("e_future").commandId,
        receipts: [], auditEvent: expenseAudit("e_future"), idempotency: expenseDescriptor("e_future"),
      })).rejects.toMatchObject({ code: "EXPENSE_DATE_IN_FUTURE" });

      const tooOld = { ...expenseRecord("e_too_old"), expenseDate: expenseDate("2026-05-31") };
      await expect(persistence.createExpense({
        expense: tooOld, actorId: LEADER, commandId: expenseDescriptor("e_too_old").commandId,
        receipts: [], auditEvent: expenseAudit("e_too_old"), idempotency: expenseDescriptor("e_too_old"),
      })).rejects.toMatchObject({ code: "EXPENSE_DATE_OUTSIDE_ALLOWED_WINDOW" });
      expect(await reader.getRow("expenses", "e_too_old")).toBeUndefined();

      await expect(persistence.createExpense({
        expense: expenseRecord("e_receipt"), actorId: LEADER, commandId: expenseDescriptor("e_receipt").commandId,
        receipts: [{ metadata: {} as never, content: {} as never }], auditEvent: expenseAudit("e_receipt"), idempotency: expenseDescriptor("e_receipt"),
      })).rejects.toMatchObject({ code: "COMMANDS_UNAVAILABLE" });
    });

    it("allows an old Expense name edit but rejects changing it to another out-of-window date", async () => {
      const original = expenseRecord("e_historical");
      await persistence.createExpense({
        expense: original, actorId: LEADER, commandId: expenseDescriptor("e_historical").commandId,
        receipts: [], auditEvent: expenseAudit("e_historical"), idempotency: expenseDescriptor("e_historical"),
      });
      reader.seed("expenses", (await reader.listRows("expenses")).map((row) => (
        row.$id === "e_historical" ? { ...row, expenseDate: "2026-05-31" } : row
      )));

      const historical: Expense = { ...original, expenseDate: expenseDate("2026-05-31") };
      const renamed: Expense = {
        ...historical,
        name: "Historical renamed",
        revision: 2,
        updatedAt: isoInstant("2026-08-26T10:00:00.000Z"),
      };
      await runWithCommandEnvelope(
        { commandType: "edit-expense", commandId: "k_edit_historical", intentSeed: { expenseId: "e_historical", name: renamed.name } },
        () => persistence.editExpense({
          expectedExpenseId: historical.expenseId, actorId: LEADER, commandId: commandId("k_edit_historical"),
          expense: renamed, expectedRevision: 1, backdatedConfirmationApplicable: false,
          auditEvents: [{ ...expenseAudit("e_historical", "edited", renamed.updatedAt), auditEventId: auditEventId("a_e_historical_renamed") }],
        }),
      );
      expect(await reader.getRow("expenses", "e_historical")).toMatchObject({
        name: "Historical renamed", expenseDate: "2026-05-31", revision: 2,
      });

      const changedDate: Expense = {
        ...renamed,
        expenseDate: expenseDate("2026-05-30"),
        revision: 3,
        updatedAt: isoInstant("2026-08-26T11:00:00.000Z"),
      };
      await expect(runWithCommandEnvelope(
        { commandType: "edit-expense", commandId: "k_edit_historical_date", intentSeed: { expenseId: "e_historical", expenseDate: changedDate.expenseDate } },
        () => persistence.editExpense({
          expectedExpenseId: historical.expenseId, actorId: LEADER, commandId: commandId("k_edit_historical_date"),
          expense: changedDate, expectedRevision: 2, backdatedConfirmationApplicable: false,
          auditEvents: [{ ...expenseAudit("e_historical", "edited", changedDate.updatedAt), auditEventId: auditEventId("a_e_historical_date") }],
        }),
      )).rejects.toMatchObject({ code: "EXPENSE_DATE_OUTSIDE_ALLOWED_WINDOW" });
      expect(await reader.getRow("expenses", "e_historical")).toMatchObject({ expenseDate: "2026-05-31", revision: 2 });
    });

    it("enforces revision OCC and the Confirmed-Settlement financial lock while allowing name-only edit", async () => {
      const original = expenseRecord("e_locked");
      await persistence.createExpense({
        expense: original, actorId: LEADER, commandId: expenseDescriptor("e_locked").commandId,
        receipts: [], auditEvent: expenseAudit("e_locked"), idempotency: expenseDescriptor("e_locked"),
      });
      reader.seed("settlements", [{
        $id: "s_confirmed", householdId: HH, senderId: JOHN, receiverId: LEADER,
        amountPoisha: 150, originalAmountPoisha: 150, status: "confirmed",
        pairKey: JSON.stringify([HH, JOHN, LEADER]), recommendationDigest: "digest",
        createdAt: T0, resolvedAt: "2026-08-26T10:00:00.000Z",
      }]);
      const renamed: Expense = { ...original, name: "Renamed only", revision: 2, updatedAt: isoInstant("2026-08-26T11:00:00.000Z") };
      await runWithCommandEnvelope(
        { commandType: "edit-expense", commandId: "k_edit_locked", intentSeed: { expenseId: "e_locked", name: "Renamed only" } },
        () => persistence.editExpense({
          expectedExpenseId: original.expenseId, actorId: LEADER, commandId: commandId("k_edit_locked"),
          expense: renamed, expectedRevision: 1, relevantIntentDigest: expenseRelevantIntentDigest({
            amount: renamed.amount, expenseDate: renamed.expenseDate, splitMethod: renamed.splitMethod,
            allocations: renamed.allocations, paymentMethod: "cash",
          }), backdatedConfirmationApplicable: true, auditEvents: [expenseAudit("e_locked", "edited", renamed.updatedAt)],
        }),
      );
      expect(await reader.getRow("expenses", "e_locked")).toMatchObject({ name: "Renamed only", revision: 2 });

      const financial: Expense = { ...renamed, amount: positivePoisha(302), allocations: allocateEqualSplit(positivePoisha(302), [LEADER, JOHN]), revision: 3, updatedAt: isoInstant("2026-08-26T12:00:00.000Z") };
      await expect(runWithCommandEnvelope(
        { commandType: "edit-expense", commandId: "k_edit_financial", intentSeed: { expenseId: "e_locked", amount: 302 } },
        () => persistence.editExpense({
          expectedExpenseId: original.expenseId, actorId: LEADER, commandId: commandId("k_edit_financial"),
          expense: financial, expectedRevision: 2, backdatedConfirmationApplicable: true,
          auditEvents: [expenseAudit("e_locked", "edited", financial.updatedAt)],
        }),
      )).rejects.toMatchObject({ code: "EXPENSE_FINANCIAL_HISTORY_LOCKED" });
      expect(await reader.getRow("expenses", "e_locked")).toMatchObject({ amountPoisha: 300, revision: 2 });

      await expect(persistence.editExpense({
        expectedExpenseId: original.expenseId, actorId: LEADER, expense: { ...renamed, revision: 3, updatedAt: financial.updatedAt },
        expectedRevision: 1, auditEvents: [expenseAudit("e_locked", "edited", financial.updatedAt)],
      })).rejects.toMatchObject({ code: "EXPENSE_VERSION_CONFLICT" });
    });

    it("creates comments independently of the Expense aggregate and replays without duplicates", async () => {
      const expense = expenseRecord("e_comment");
      await persistence.createExpense({
        expense, actorId: LEADER, commandId: commandId("k_comment_expense"), receipts: [],
        auditEvent: expenseAudit("e_comment"),
        idempotency: { actorId: LEADER, commandType: "create-expense", commandId: commandId("k_comment_expense"), intentDigest: canonicalIntentDigest({ expenseId: "e_comment" }) },
      });
      const expenseBefore = structuredClone(await reader.getRow("expenses", "e_comment"));
      const auditsBefore = structuredClone(await reader.listRows("audit_events"));
      const comment: ExpenseComment = {
        commentId: expenseCommentId("comment_1"), householdId: HH, expenseId: expense.expenseId,
        authorUserId: JOHN, body: "Hello\nthere", createdAt: T1,
      };
      const idempotency: IdempotencyDescriptor = {
        actorId: JOHN, commandType: "create-expense-comment", commandId: commandId("k_comment"),
        intentDigest: canonicalIntentDigest({ expenseId: comment.expenseId, body: comment.body }),
      };

      expect(await persistence.createExpenseComment({ comment, idempotency })).toBe("comment_1");
      expect(await reader.getRow("expense_comments", "comment_1")).toMatchObject({
        householdId: HH, expenseId: expense.expenseId, authorUserId: JOHN, body: "Hello\nthere", createdAt: T1,
      });
      expect(await reader.getRow("expenses", "e_comment")).toEqual(expenseBefore);
      expect(await reader.listRows("audit_events")).toEqual(auditsBefore);
      expect(await persistence.createExpenseComment({ comment, idempotency })).toBe("comment_1");
      expect(await reader.listRows("expense_comments")).toHaveLength(1);
      await expect(persistence.createExpenseComment({
        comment: { ...comment, commentId: expenseCommentId("comment_2"), body: "Changed" },
        idempotency: { ...idempotency, intentDigest: canonicalIntentDigest({ expenseId: comment.expenseId, body: "Changed" }) },
      })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    });
  });

  describe("R3E Settlement commands", () => {
    beforeEach(async () => {
      const expense = expenseRecord("e_balance");
      await persistence.createExpense({
        expense, actorId: LEADER, commandId: commandId("k_balance"), receipts: [],
        auditEvent: expenseAudit("e_balance"),
        idempotency: {
          actorId: LEADER, commandType: "create-expense", commandId: commandId("k_balance"),
          intentDigest: canonicalIntentDigest({ expenseId: "e_balance" }),
        },
      });
    });

    it("creates only the exact recommendation, records zero-effect Pending, and rejects the unordered duplicate", async () => {
      const settlement = pendingSettlement();
      const idempotency = {
        actorId: JOHN, commandType: "create-pending-settlement", commandId: commandId("k_settle"),
        intentDigest: canonicalIntentDigest(settlement.originatingRecommendation),
      } as const;
      const created = await persistence.createSettlement({ settlement, auditEvent: settlementAudit("s_pending"), idempotency });
      expect(created).toBe("s_pending");
      expect(await reader.getRow("settlements", "s_pending")).toMatchObject({
        senderId: JOHN, receiverId: LEADER, amountPoisha: 150, originalAmountPoisha: 150, status: "pending", resolvedAt: null,
      });
      expect(persistence.lastR3StagedOperations.createSettlement).toBe(5);

      const duplicate = { ...pendingSettlement("s_reverse"), senderId: LEADER, receiverId: JOHN,
        originatingRecommendation: { householdId: HH, senderId: LEADER, receiverId: JOHN, amount: positivePoisha(150) } };
      await expect(persistence.createSettlement({
        settlement: duplicate, auditEvent: settlementAudit("s_reverse", LEADER),
        idempotency: { actorId: LEADER, commandType: "create-pending-settlement", commandId: commandId("k_reverse"), intentDigest: canonicalIntentDigest(duplicate.originatingRecommendation) },
      })).rejects.toMatchObject({ code: "DUPLICATE_PENDING_SETTLEMENT" });
      expect(await reader.getRow("settlements", "s_reverse")).toBeUndefined();
    });

    it("authorizes receiver Confirm, preserves the original amount, and makes terminal history immutable", async () => {
      const current = pendingSettlement();
      await persistence.createSettlement({
        settlement: current, auditEvent: settlementAudit("s_pending"),
        idempotency: { actorId: JOHN, commandType: "create-pending-settlement", commandId: commandId("k_settle"), intentDigest: canonicalIntentDigest(current.originatingRecommendation) },
      });
      const resolvedAt = isoInstant("2026-08-26T10:00:00.000Z");
      const confirmed: SettlementRecord = { ...current, status: "confirmed", resolvedAt };
      await runWithCommandEnvelope(
        { commandType: "confirm-settlement", commandId: "k_confirm", intentSeed: { settlementId: "s_pending", status: "confirmed" } },
        () => persistence.transitionSettlement({
          settlement: confirmed, expectedStatus: "pending", auditEvent: settlementAudit("s_pending", LEADER, "confirmed", resolvedAt),
        }),
      );
      expect(await reader.getRow("settlements", "s_pending")).toMatchObject({ status: "confirmed", amountPoisha: 150, originalAmountPoisha: 150, resolvedAt });
      expect(persistence.lastR3StagedOperations["settlement-confirmed"]).toBe(5);

      await expect(persistence.transitionSettlement({
        settlement: { ...confirmed, status: "rejected" }, expectedStatus: "pending",
        auditEvent: settlementAudit("s_pending", LEADER, "rejected", resolvedAt),
      })).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("rejects the wrong transition actor without releasing the Pending-pair guard", async () => {
      const current = pendingSettlement();
      await persistence.createSettlement({
        settlement: current, auditEvent: settlementAudit("s_pending"),
        idempotency: { actorId: JOHN, commandType: "create-pending-settlement", commandId: commandId("k_settle"), intentDigest: canonicalIntentDigest(current.originatingRecommendation) },
      });
      const resolvedAt = isoInstant("2026-08-26T10:00:00.000Z");
      await expect(persistence.transitionSettlement({
        settlement: { ...current, status: "confirmed", resolvedAt }, expectedStatus: "pending",
        auditEvent: settlementAudit("s_pending", JOHN, "confirmed", resolvedAt),
      })).rejects.toMatchObject({ code: "SETTLEMENT_ACTOR_NOT_RECEIVER" });
      expect(await reader.getRow("settlements", "s_pending")).toMatchObject({ status: "pending" });
    });
  });
});
