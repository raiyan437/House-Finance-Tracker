import { beforeEach, describe, expect, it } from "vitest";
import type { TablesDB } from "node-appwrite";
import { AppwriteCommandPersistence } from "./command-persistence.server";
import { TransactionFailure } from "./tx-errors.server";
import { runWithCommandEnvelope } from "./command-envelope.server";
import { createInMemoryTablesDB, InMemoryTablesReader } from "../reads/in-memory-tables-reader.helper";
import { guardRowId, membershipRowId } from "../ids";
import { canonicalIntentDigest, type IdempotencyDescriptor } from "@/application/idempotency/command-idempotency";
import { auditEventId, commandId, householdId, joinRequestId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import type { AuditEvent } from "@/domain/records/domain-records";

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
  reader.seed("settlements", []);
  reader.seed("command_outcomes", []);
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

describe("R2 trusted command kernel", () => {
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
});
