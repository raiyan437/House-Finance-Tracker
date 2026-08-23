import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UserProfile } from "@/domain/records/domain-records";
import {
  auditEventId,
  commandId,
  householdId,
  joinRequestId,
  userId,
} from "@/domain/shared/identifiers";
import { isoInstant, type IsoInstant } from "@/domain/shared/instant";
import { IndexedDbAtomicApplicationPersistence } from "@/infrastructure/indexeddb/atomic-persistence";
import { deleteLocalDatabase, openLocalDatabase } from "@/infrastructure/indexeddb/database";
import { LocalCurrentSession } from "@/infrastructure/indexeddb/development-session";
import { IndexedDbRepositories } from "@/infrastructure/indexeddb/repositories";
import {
  SEEDED_HOUSEHOLD_ID,
  SEEDED_USER_IDS,
  seedLocalDatabase,
} from "@/infrastructure/indexeddb/seed";
import type { HouseFinanceDatabase } from "@/infrastructure/indexeddb/records";
import type { IDBPDatabase } from "idb";
import {
  HouseFinanceApplication,
  type ApplicationValues,
  type GeneratedIdKind,
} from "./application-services";

class HouseholdValues implements ApplicationValues {
  private counter = 0;
  readonly candidatesUsed: string[] = [];

  constructor(private readonly candidates: string[] = ["987654321"]) {}

  now(): IsoInstant { return isoInstant("2026-08-13T14:00:00.000Z"); }
  nextId(kind: GeneratedIdKind): string { this.counter += 1; return `${kind}-onboarding-${this.counter}`; }
  nextHouseholdCodeCandidate(): string {
    const candidate = this.candidates.shift() ?? "987654321";
    this.candidatesUsed.push(candidate);
    return candidate;
  }
}

describe("Phase 6 household onboarding application flows", () => {
  let databaseName: string;
  let database: IDBPDatabase<HouseFinanceDatabase>;
  let repositories: IndexedDbRepositories;
  let session: LocalCurrentSession;
  let atomic: IndexedDbAtomicApplicationPersistence;
  let application: HouseFinanceApplication;

  beforeEach(async () => {
    databaseName = `household-onboarding-${crypto.randomUUID()}`;
    database = await openLocalDatabase(databaseName);
    await seedLocalDatabase(database);
    repositories = new IndexedDbRepositories(database);
    session = new LocalCurrentSession(database);
    atomic = new IndexedDbAtomicApplicationPersistence(database);
    application = new HouseFinanceApplication({ repositories, atomic, session, values: new HouseholdValues() });
  });

  afterEach(async () => {
    database.close();
    await deleteLocalDatabase(databaseName);
  });

  it("projects leader, member, Pending, and no-household states without pre-acceptance data leakage", async () => {
    const leader = await application.households.getCurrentAccessState();
    expect(leader).toMatchObject({
      status: "active-leader",
      household: { name: "Raiyan House", code: "012345678" },
      joinRequests: [{ requesterName: "Alex" }],
    });

    await session.switchIdentity(SEEDED_USER_IDS.john);
    expect(await application.households.getCurrentAccessState()).toMatchObject({
      status: "active-member",
      household: { householdId: SEEDED_HOUSEHOLD_ID, name: "Raiyan House", code: "012345678" },
    });

    await session.switchIdentity(SEEDED_USER_IDS.alex);
    const pending = await application.households.getCurrentAccessState();
    expect(pending).toEqual({
      status: "pending-request",
      request: {
        joinRequestId: joinRequestId("join-alex-main"),
        household: { householdId: SEEDED_HOUSEHOLD_ID, name: "Raiyan House", code: "012345678" },
        createdAt: isoInstant("2026-08-13T00:00:00.000Z"),
      },
    });
    expect(Object.keys((pending as Extract<typeof pending, { status: "pending-request" }>).request.household).sort()).toEqual(["code", "householdId", "name"]);
    expect(JSON.stringify(pending)).not.toMatch(/member|expense|balance|settlement|receipt|card/i);

    await application.households.cancelJoinRequest(joinRequestId("join-alex-main"));
    expect(await application.households.getCurrentAccessState()).toEqual({ status: "no-household" });
  });

  it("creates a trimmed household with a manual leading-zero code and active leader membership", async () => {
    await session.switchIdentity(SEEDED_USER_IDS.alex);
    await application.households.cancelJoinRequest(joinRequestId("join-alex-main"));
    const created = await application.households.createHousehold("  Zero House  ", "000000001");

    expect(created).toMatchObject({ name: "Zero House", code: "000000001" });
    expect(await repositories.memberships.findActiveByUser(SEEDED_USER_IDS.alex)).toEqual({
      householdId: created.householdId,
      userId: SEEDED_USER_IDS.alex,
      status: "active",
      role: "leader",
    });
    expect(await application.households.getCurrentAccessState()).toMatchObject({ status: "active-leader" });
  });

  it("rejects invalid and duplicate codes without changing membership", async () => {
    await session.switchIdentity(SEEDED_USER_IDS.alex);
    await application.households.cancelJoinRequest(joinRequestId("join-alex-main"));

    for (const code of ["", "12345678", "1234567890", "12345x789", "১২৩৪৫৬৭৮৯"]) {
      await expect(application.households.createHousehold("Alex House", code)).rejects.toMatchObject({ code: "INVALID_HOUSEHOLD_CODE" });
    }
    await expect(application.households.createHousehold("Alex House", "012345678")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await repositories.memberships.findActiveByUser(SEEDED_USER_IDS.alex)).toBeUndefined();
  });

  it("generates a unique nine-digit code after collisions and stops after 32 collisions", async () => {
    const succeeds = new HouseholdValues(["012345678", "000000777"]);
    application = new HouseFinanceApplication({ repositories, atomic, session, values: succeeds });
    expect(await application.households.generateUniqueHouseholdCode()).toBe("000000777");
    expect(succeeds.candidatesUsed).toEqual(["012345678", "000000777"]);

    const exhausted = new HouseholdValues(Array.from({ length: 32 }, () => "012345678"));
    application = new HouseFinanceApplication({ repositories, atomic, session, values: exhausted });
    await expect(application.households.generateUniqueHouseholdCode()).rejects.toMatchObject({
      code: "HOUSEHOLD_CODE_GENERATION_EXHAUSTED",
    });
    expect(exhausted.candidatesUsed).toHaveLength(32);
  });

  it("enforces active-membership and Pending-request creation/join rules in application services", async () => {
    await expect(application.households.createHousehold("Second House", "000000002")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(application.households.requestToJoin(SEEDED_HOUSEHOLD_ID)).rejects.toMatchObject({ code: "CONFLICT" });

    await session.switchIdentity(SEEDED_USER_IDS.alex);
    await expect(application.households.createHousehold("Alex House", "000000003")).rejects.toThrow("Cancel the current Pending join request first.");
    await expect(application.households.requestToJoin(SEEDED_HOUSEHOLD_ID)).rejects.toThrow("already has a Pending join request");
  });

  it("validates private household lookup and supports cancellation followed by a new request", async () => {
    await session.switchIdentity(SEEDED_USER_IDS.alex);
    await application.households.cancelJoinRequest(joinRequestId("join-alex-main"));

    await expect(application.households.findHouseholdForJoin("123")).rejects.toMatchObject({ code: "INVALID_HOUSEHOLD_CODE" });
    await expect(application.households.findHouseholdForJoin("999999999")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const found = await application.households.findHouseholdForJoin("012345678");
    expect(found).toEqual({ householdId: SEEDED_HOUSEHOLD_ID, name: "Raiyan House", code: "012345678" });

    const request = await application.households.requestToJoin(found.householdId);
    expect(request.status).toBe("pending");
    const history = await repositories.joinRequests.listByHousehold(SEEDED_HOUSEHOLD_ID);
    expect(history.map(({ status }) => status).sort()).toEqual(["cancelled", "pending"]);
    await expect(application.households.requestToJoin(found.householdId)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lets only the correct leader reject and preserves terminal history", async () => {
    await session.switchIdentity(SEEDED_USER_IDS.john);
    await expect(application.households.rejectJoinRequest(joinRequestId("join-alex-main"))).rejects.toMatchObject({ code: "HOUSEHOLD_STATE_CHANGED" });

    const outsiderId = userId("user-other-leader");
    const now = isoInstant("2026-08-13T14:00:00.000Z");
    const profile: UserProfile = { userId: outsiderId, displayName: "Other Leader", displayEmail: "other@local.test", emailKey: "other@local.test", createdAt: now, updatedAt: now };
    const otherHouse = { householdId: householdId("household-other"), name: "Other House", code: "000000004", createdAt: now, updatedAt: now };
    await repositories.profiles.create(profile);
    await repositories.households.create(otherHouse);
    await repositories.memberships.create({ householdId: otherHouse.householdId, userId: outsiderId, status: "active", role: "leader" });
    await session.switchIdentity(outsiderId);
    await expect(application.households.rejectJoinRequest(joinRequestId("join-alex-main"))).rejects.toMatchObject({ code: "HOUSEHOLD_STATE_CHANGED" });

    await session.switchIdentity(SEEDED_USER_IDS.raiyan);
    await application.households.rejectJoinRequest(joinRequestId("join-alex-main"));
    expect(await repositories.joinRequests.getById(joinRequestId("join-alex-main"))).toMatchObject({ status: "rejected" });
    await session.switchIdentity(SEEDED_USER_IDS.alex);
    expect(await application.households.getCurrentAccessState()).toEqual({ status: "no-household" });
  });

  it("accepts atomically and creates exactly one active membership with audit history", async () => {
    await application.households.acceptJoinRequest(joinRequestId("join-alex-main"));
    expect(await repositories.joinRequests.getById(joinRequestId("join-alex-main"))).toMatchObject({ status: "accepted" });
    expect(await repositories.memberships.findActiveByUser(SEEDED_USER_IDS.alex)).toMatchObject({ householdId: SEEDED_HOUSEHOLD_ID, role: "member" });
    expect((await repositories.memberships.listByHousehold(SEEDED_HOUSEHOLD_ID)).filter((membership) => membership.userId === SEEDED_USER_IDS.alex && membership.status === "active")).toHaveLength(1);
    expect(await repositories.auditEvents.listByHousehold(SEEDED_HOUSEHOLD_ID)).toContainEqual(expect.objectContaining({ aggregateId: "join-alex-main", action: "accepted" }));
  });

  it("prevents acceptance when the requester acquires another active membership", async () => {
    const otherHouse = householdId("household-race");
    const now = isoInstant("2026-08-13T14:00:00.000Z");
    await repositories.households.create({ householdId: otherHouse, name: "Race House", code: "000000005", createdAt: now, updatedAt: now });
    await repositories.memberships.create({ householdId: otherHouse, userId: SEEDED_USER_IDS.alex, status: "active", role: "member" });

    await expect(application.households.acceptJoinRequest(joinRequestId("join-alex-main"))).rejects.toMatchObject({ code: "HOUSEHOLD_STATE_CHANGED" });
    expect(await repositories.joinRequests.getById(joinRequestId("join-alex-main"))).toMatchObject({ status: "pending" });
    expect(await repositories.memberships.get(SEEDED_HOUSEHOLD_ID, SEEDED_USER_IDS.alex)).toBeUndefined();
    expect((await repositories.auditEvents.listByHousehold(SEEDED_HOUSEHOLD_ID)).filter((entry) => entry.aggregateId === "join-alex-main" && entry.action === "accepted")).toHaveLength(0);
  });

  it("rolls back request, membership, and audit writes when atomic acceptance fails", async () => {
    const pending = (await repositories.joinRequests.getById(joinRequestId("join-alex-main")))!;
    const duplicateAudit = {
      auditEventId: auditEventId("audit-seed-household"),
      householdId: SEEDED_HOUSEHOLD_ID,
      actorId: SEEDED_USER_IDS.raiyan,
      aggregateType: "join-request" as const,
      aggregateId: pending.joinRequestId,
      action: "accepted",
      occurredAt: isoInstant("2026-08-13T14:00:00.000Z"),
      changedFields: ["status", "membership"],
    };

    await expect(atomic.acceptJoinRequest({
      joinRequestId: pending.joinRequestId,
      actorId: SEEDED_USER_IDS.raiyan,
      resolvedAt: isoInstant("2026-08-13T14:00:00.000Z"),
      auditEvent: duplicateAudit,
    })).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await repositories.joinRequests.getById(pending.joinRequestId)).toMatchObject({ status: "pending" });
    expect(await repositories.memberships.get(SEEDED_HOUSEHOLD_ID, SEEDED_USER_IDS.alex)).toBeUndefined();
    expect((await repositories.auditEvents.listByHousehold(SEEDED_HOUSEHOLD_ID)).filter((entry) => entry.aggregateId === pending.joinRequestId && entry.action === "accepted")).toHaveLength(0);
  });

  it("replays Join Request and Household creates exactly once", async () => {
    await session.switchIdentity(SEEDED_USER_IDS.alex);
    await application.households.cancelJoinRequest(joinRequestId("join-alex-main"));
    const firstRequest = await application.households.requestToJoin(SEEDED_HOUSEHOLD_ID, commandId("idem-join"));
    const replayedRequest = await application.households.requestToJoin(SEEDED_HOUSEHOLD_ID, commandId("idem-join"));
    expect(replayedRequest.joinRequestId).toBe(firstRequest.joinRequestId);
    expect((await repositories.joinRequests.listByHousehold(SEEDED_HOUSEHOLD_ID)).filter((item) => item.joinRequestId === firstRequest.joinRequestId)).toHaveLength(1);
    await application.households.cancelJoinRequest(firstRequest.joinRequestId);

    const firstHousehold = await application.households.createHousehold("Retry House", "000000111", commandId("idem-household"));
    const replayedHousehold = await application.households.createHousehold("Retry House", "000000111", commandId("idem-household"));
    expect(replayedHousehold.householdId).toBe(firstHousehold.householdId);
    await expect(application.households.createHousehold("Changed House", "000000111", commandId("idem-household"))).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("renames the Household as Leader only, with sanitized audit and unchanged-name suppression", async () => {
    const auditsBefore = (await repositories.auditEvents.listByHousehold(SEEDED_HOUSEHOLD_ID)).length;

    const renamed = await application.households.renameHousehold("  Sunrise Villa  ");
    expect(renamed.name).toBe("Sunrise Villa");
    expect(renamed.updatedAt).toBe("2026-08-13T14:00:00.000Z");
    expect((await repositories.households.getById(SEEDED_HOUSEHOLD_ID))?.name).toBe("Sunrise Villa");
    const auditsAfterRename = await repositories.auditEvents.listByHousehold(SEEDED_HOUSEHOLD_ID);
    expect(auditsAfterRename).toHaveLength(auditsBefore + 1);
    expect(auditsAfterRename.at(-1)).toMatchObject({
      action: "renamed",
      aggregateType: "household",
      actorId: SEEDED_USER_IDS.raiyan,
      changedFields: ["name"],
    });
    expect(JSON.stringify(auditsAfterRename.at(-1))).not.toMatch(/Raiyan House|Sunrise Villa/);

    await application.households.renameHousehold("Sunrise Villa");
    expect(await repositories.auditEvents.listByHousehold(SEEDED_HOUSEHOLD_ID)).toHaveLength(auditsBefore + 1);

    await session.switchIdentity(SEEDED_USER_IDS.john);
    await expect(application.households.renameHousehold("Member Name")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await repositories.households.getById(SEEDED_HOUSEHOLD_ID))?.name).toBe("Sunrise Villa");

    await session.switchIdentity(SEEDED_USER_IDS.raiyan);
    await expect(application.households.renameHousehold("   ")).rejects.toMatchObject({ code: "INVALID_HOUSEHOLD" });
    await session.switchIdentity(SEEDED_USER_IDS.alex);
    await expect(application.households.renameHousehold("Outsider Name")).rejects.toMatchObject({ code: "HOUSEHOLD_STATE_CHANGED" });
    expect((await repositories.households.getById(SEEDED_HOUSEHOLD_ID))?.name).toBe("Sunrise Villa");
  });
});
