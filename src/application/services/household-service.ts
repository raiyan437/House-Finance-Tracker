import { ApplicationError } from "../errors/application-error";
import { assertIdempotentIntent, canonicalIntentDigest, type IdempotencyDescriptor } from "../idempotency/command-idempotency";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import { assertHousehold, assertJoinRequest, type Household, type JoinRequest } from "@/domain/records/domain-records";
import { auditEventId, householdId, joinRequestId, type HouseholdId, type JoinRequestId, type UserId } from "@/domain/shared/identifiers";
import { commandId, type CommandId } from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";
import { buildActiveHouseholdPageView, type ActiveHouseholdPageView } from "@/application/household/household-page";
import { type Dependencies, event, requireActiveMembership, financialContext } from "./service-context";


export interface JoinableHouseholdView {
  readonly householdId: HouseholdId;
  readonly name: string;
  readonly code: string;
}

export interface PendingJoinRequestView {
  readonly joinRequestId: JoinRequestId;
  readonly household: JoinableHouseholdView;
  readonly createdAt: IsoInstant;
}

export interface LeaderJoinRequestView {
  readonly joinRequestId: JoinRequestId;
  readonly requesterName: string;
  readonly createdAt: IsoInstant;
}

export type HouseholdAccessState =
  | Readonly<{ status: "no-household" }>
  | Readonly<{ status: "pending-request"; request: PendingJoinRequestView }>
  | Readonly<{
      status: "active-member";
      household: JoinableHouseholdView;
      page: ActiveHouseholdPageView;
    }>
  | Readonly<{
      status: "active-leader";
      household: JoinableHouseholdView;
      page: ActiveHouseholdPageView;
      joinRequests: readonly LeaderJoinRequestView[];
    }>;

export class HouseholdApplicationService {
  constructor(private readonly deps: Dependencies) {}

  async getCurrentAccessState(): Promise<HouseholdAccessState> {
    const actor = await this.deps.session.getCurrentUserId();
    const membership = await this.deps.repositories.memberships.findActiveByUser(actor);

    if (!membership) {
      const request = await this.deps.repositories.joinRequests.findPendingByUser(actor);
      if (!request) return Object.freeze({ status: "no-household" });

      const household = await this.deps.repositories.households.getById(request.householdId);
      if (!household || household.deletedAt) {
        throw new ApplicationError("CONFLICT", "The Pending join request refers to an unavailable household.");
      }

      return Object.freeze({
        status: "pending-request",
        request: Object.freeze({
          joinRequestId: request.joinRequestId,
          household: this.projectJoinableHousehold(household),
          createdAt: request.createdAt,
        }),
      });
    }

    const household = await this.deps.repositories.households.getById(membership.householdId);
    if (!household || household.deletedAt) {
      throw new ApplicationError("CONFLICT", "The active membership refers to an unavailable household.");
    }

    const householdView = this.projectJoinableHousehold(household);
    const context = await financialContext(this.deps.repositories, household.householdId);
    const activeIds = context.memberships
      .filter((item) => item.status === "active")
      .map((item) => item.userId);
    const profiles = await this.deps.repositories.profiles.getByIds(activeIds);
    const page = buildActiveHouseholdPageView({
      household,
      actorId: actor,
      memberships: context.memberships,
      profiles,
      sheet: context.sheet,
      settlements: context.settlements,
    });
    if (membership.role === "member") {
      return Object.freeze({ status: "active-member", household: householdView, page });
    }

    const requests = (await this.deps.repositories.joinRequests.listByHousehold(household.householdId))
      .filter((request) => request.status === "pending");
    const requesterProfiles = await this.deps.repositories.profiles.getByIds(requests.map((request) => request.userId));
    const names = new Map(requesterProfiles.map((profile) => [profile.userId, profile.displayName]));
    const joinRequests = requests
      .map((request): LeaderJoinRequestView => Object.freeze({
        joinRequestId: request.joinRequestId,
        requesterName: names.get(request.userId) ?? "Unknown requester",
        createdAt: request.createdAt,
      }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    return Object.freeze({
      status: "active-leader",
      household: householdView,
      page,
      joinRequests: Object.freeze(joinRequests),
    });
  }

  async findHouseholdForJoin(code: string): Promise<JoinableHouseholdView> {
    const actor = await this.deps.session.getCurrentUserId();
    this.assertHouseholdCode(code);
    if (await this.deps.repositories.memberships.findActiveByUser(actor)) {
      throw new ApplicationError("CONFLICT", "The current user already belongs to a household.");
    }
    if (await this.deps.repositories.joinRequests.findPendingByUser(actor)) {
      throw new ApplicationError("CONFLICT", "The current user already has a Pending join request.");
    }
    const household = await this.deps.repositories.households.findByCode(code);
    if (!household || household.deletedAt) {
      throw new ApplicationError("NOT_FOUND", "No household was found for that code.");
    }
    return this.projectJoinableHousehold(household);
  }

  async generateUniqueHouseholdCode(): Promise<string> {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const candidate = this.deps.values.nextHouseholdCodeCandidate();
      this.assertHouseholdCode(candidate);
      if (!(await this.deps.repositories.households.findByCode(candidate))) return candidate;
    }
    throw new ApplicationError(
      "HOUSEHOLD_CODE_GENERATION_EXHAUSTED",
      "A unique household code could not be generated. Try again.",
    );
  }

  async getCurrentHousehold(): Promise<Readonly<{ household: Household; memberships: readonly MembershipSnapshot[] }> | undefined> {
    const actor = await this.deps.session.getCurrentUserId();
    const membership = await this.deps.repositories.memberships.findActiveByUser(actor);
    if (!membership) return undefined;
    const household = await this.deps.repositories.households.getById(membership.householdId);
    if (!household || household.deletedAt) return undefined;
    return Object.freeze({ household, memberships: await this.deps.repositories.memberships.listByHousehold(household.householdId) });
  }

  async renameHousehold(name: string): Promise<Household> {
    const actor = await this.deps.session.getCurrentUserId();
    const membership = await this.currentActiveHousehold(actor);
    if (membership.role !== "leader") throw new ApplicationError("NOT_FOUND", "Household not found.");
    const household = await this.deps.repositories.households.getById(membership.householdId);
    if (!household || household.deletedAt) throw new ApplicationError("NOT_FOUND", "Household not found.");
    const trimmedName = name.trim();
    assertHousehold({ ...household, name: trimmedName });
    if (trimmedName === household.name) return household;
    await this.deps.atomic.renameHousehold({
      householdId: household.householdId,
      actorId: actor,
      name: trimmedName,
      occurredAt: this.deps.values.now(),
      auditEvent: event(this.deps.values, household.householdId, actor, "household", household.householdId, "renamed", ["name"]),
    });
    const committed = await this.deps.repositories.households.getById(household.householdId);
    if (!committed || committed.deletedAt) throw new ApplicationError("NOT_FOUND", "Household not found.");
    return committed;
  }

  async listJoinRequests(household: HouseholdId): Promise<readonly JoinRequest[]> {
    const actor = await this.deps.session.getCurrentUserId();
    const membership = await requireActiveMembership(this.deps.repositories, household, actor);
    if (membership.role !== "leader") throw new ApplicationError("NOT_FOUND", "Household join requests not found.");
    return this.deps.repositories.joinRequests.listByHousehold(household);
  }

  async createHousehold(name: string, code: string, requestedCommandId?: CommandId): Promise<Household> {
    const actor = await this.deps.session.getCurrentUserId();
    const trimmedName = name.trim();
    const activeCommandId = requestedCommandId ?? commandId(this.deps.values.nextId("command"));
    const idempotency: IdempotencyDescriptor = { actorId: actor, commandType: "create-household", commandId: activeCommandId, intentDigest: canonicalIntentDigest({ name: trimmedName, code }) };
    const replay = await this.deps.repositories.commandOutcomes.get(idempotency);
    if (replay) {
      assertIdempotentIntent(replay, idempotency);
      const replayed = await this.deps.repositories.households.getById(householdId(replay.resourceId));
      const membership = replayed ? await this.deps.repositories.memberships.get(replayed.householdId, actor) : undefined;
      if (!replayed || replayed.deletedAt || !membership || membership.status !== "active") throw new ApplicationError("NOT_FOUND", "Household not found.");
      return replayed;
    }
    this.assertHouseholdCode(code);
    if (await this.deps.repositories.memberships.findActiveByUser(actor)) throw new ApplicationError("CONFLICT", "The current user already belongs to a household.");
    if (await this.deps.repositories.joinRequests.findPendingByUser(actor)) throw new ApplicationError("CONFLICT", "Cancel the current Pending join request first.");
    if (await this.deps.repositories.households.findByCode(code)) throw new ApplicationError("CONFLICT", "Household code is already in use.");
    const now = this.deps.values.now();
    const household: Household = { householdId: householdId(this.deps.values.nextId("household")), name: trimmedName, code, createdAt: now, updatedAt: now };
    assertHousehold(household);
    const leaderMembership: MembershipSnapshot = { householdId: household.householdId, userId: actor, status: "active", role: "leader" };
    const resourceId = await this.deps.atomic.createHousehold({ household, leaderMembership, idempotency, auditEvent: event(this.deps.values, household.householdId, actor, "household", household.householdId, "created", ["name", "code"], now) });
    const committed = await this.deps.repositories.households.getById(householdId(resourceId));
    if (!committed || committed.deletedAt || !(await this.deps.repositories.memberships.get(committed.householdId, actor))) throw new ApplicationError("NOT_FOUND", "Household not found.");
    return committed;
  }

  async requestToJoin(household: HouseholdId, requestedCommandId?: CommandId): Promise<JoinRequest> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId = requestedCommandId ?? commandId(this.deps.values.nextId("command"));
    const idempotency: IdempotencyDescriptor = { actorId: actor, commandType: "send-join-request", commandId: activeCommandId, intentDigest: canonicalIntentDigest({ householdId: household }) };
    const replay = await this.deps.repositories.commandOutcomes.get(idempotency);
    if (replay) {
      assertIdempotentIntent(replay, idempotency);
      const replayed = await this.deps.repositories.joinRequests.getById(joinRequestId(replay.resourceId));
      if (!replayed || replayed.userId !== actor) throw new ApplicationError("NOT_FOUND", "Join request not found.");
      return replayed;
    }
    const target = await this.deps.repositories.households.getById(household);
    if (!target || target.deletedAt) throw new ApplicationError("NOT_FOUND", "Household not found.");
    if (await this.deps.repositories.memberships.findActiveByUser(actor)) throw new ApplicationError("CONFLICT", "The current user already belongs to a household.");
    if (await this.deps.repositories.joinRequests.findPendingByUser(actor)) throw new ApplicationError("CONFLICT", "The current user already has a Pending join request.");
    const now = this.deps.values.now();
    const request: JoinRequest = { joinRequestId: joinRequestId(this.deps.values.nextId("join-request")), householdId: household, userId: actor, status: "pending", createdAt: now };
    assertJoinRequest(request);
    const resourceId = await this.deps.atomic.createJoinRequest({ request, idempotency, auditEvent: event(this.deps.values, household, actor, "join-request", request.joinRequestId, "requested", ["status"], now) });
    const committed = await this.deps.repositories.joinRequests.getById(joinRequestId(resourceId));
    if (!committed || committed.userId !== actor) throw new ApplicationError("NOT_FOUND", "Join request not found.");
    return committed;
  }

  private assertHouseholdCode(code: string): void {
    if (!/^[0-9]{9}$/.test(code)) {
      throw new ApplicationError("INVALID_HOUSEHOLD_CODE", "A household code must contain exactly nine digits.");
    }
  }

  private projectJoinableHousehold(household: Household): JoinableHouseholdView {
    return Object.freeze({
      householdId: household.householdId,
      name: household.name,
      code: household.code,
    });
  }

  async acceptJoinRequest(id: JoinRequestId): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const request = await this.deps.repositories.joinRequests.getById(id);
    if (!request || request.status !== "pending") throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "The join request is no longer Pending.");
    const resolvedAt = this.deps.values.now();
    await this.deps.atomic.acceptJoinRequest({ joinRequestId: id, actorId: actor, resolvedAt, auditEvent: event(this.deps.values, request.householdId, actor, "join-request", request.joinRequestId, "accepted", ["status", "membership"]) });
  }

  async rejectJoinRequest(id: JoinRequestId): Promise<void> { await this.resolveJoinRequest(id, "rejected"); }
  async cancelJoinRequest(id: JoinRequestId): Promise<void> { await this.resolveJoinRequest(id, "cancelled"); }

  private async resolveJoinRequest(id: JoinRequestId, status: "rejected" | "cancelled"): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const request = await this.deps.repositories.joinRequests.getById(id);
    if (!request || request.status !== "pending") throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "The join request is no longer Pending.");
    if (status === "cancelled") { if (request.userId !== actor) throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "Only the requester may cancel this request."); }
    // Leader authority is deliberately re-read by the authoritative transaction.
    const resolvedAt = this.deps.values.now();
    await this.deps.atomic.transitionJoinRequest({ joinRequestId: id, actorId: actor, status, resolvedAt, auditEvent: event(this.deps.values, request.householdId, actor, "join-request", request.joinRequestId, status, ["status"]) });
  }

  private async currentActiveHousehold(actor: UserId): Promise<MembershipSnapshot> {
    const membership = await this.deps.repositories.memberships.findActiveByUser(actor);
    if (!membership) throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "You are no longer an active household member.");
    const household = await this.deps.repositories.households.getById(membership.householdId);
    if (!household || household.deletedAt) throw new ApplicationError("HOUSEHOLD_STATE_CHANGED", "The household is no longer active.");
    return membership;
  }

  async transferLeadership(targetId: UserId): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const membership = await this.currentActiveHousehold(actor);
    await this.deps.atomic.transferLeadership({ householdId: membership.householdId, actorId: actor, targetId, auditEvent: event(this.deps.values, membership.householdId, actor, "membership", targetId, "leadership-transferred", ["role"]) });
  }

  async leaveCurrentHousehold(): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const membership = await this.currentActiveHousehold(actor);
    await this.deps.atomic.leaveHousehold({ householdId: membership.householdId, actorId: actor, auditEvent: event(this.deps.values, membership.householdId, actor, "membership", actor, "left", ["status"]) });
  }

  async removeMember(targetId: UserId): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const membership = await this.currentActiveHousehold(actor);
    await this.deps.atomic.removeHouseholdMember({ householdId: membership.householdId, actorId: actor, targetId, auditEvent: event(this.deps.values, membership.householdId, actor, "membership", targetId, "removed", ["status"]) });
  }

  async deleteCurrentHousehold(): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const membership = await this.currentActiveHousehold(actor);
    const audit = event(this.deps.values, membership.householdId, actor, "household", membership.householdId, "deleted", ["deletedAt", "memberships", "joinRequests"]);
    await this.deps.atomic.deleteHousehold({ householdId: membership.householdId, actorId: actor, auditEvent: audit, joinRequestAuditIdBase: auditEventId(this.deps.values.nextId("audit")) });
  }
}
