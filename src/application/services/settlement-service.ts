import { ApplicationError } from "../errors/application-error";
import { assertIdempotentIntent, canonicalIntentDigest, type IdempotencyDescriptor } from "../idempotency/command-idempotency";
import { generateSettlementRecommendations } from "@/domain/balances/settlement-recommendations";
import { settlementId, type HouseholdId, type SettlementId, type UserId } from "@/domain/shared/identifiers";
import { commandId, type CommandId } from "@/domain/shared/identifiers";
import { createPendingSettlement } from "@/domain/settlements/pending-settlement-policy";
import { cancelSettlement, confirmSettlement, rejectSettlement } from "@/domain/settlements/settlement-lifecycle";
import type { SettlementRecommendation, SettlementStatus } from "@/domain/settlements/settlement-types";
import { buildPendingSettlementActionPreview, buildSettlementPageView, type PendingSettlementView, type SettlementPageView } from "@/application/settlements/settlement-page";
import { type Dependencies, event, requireActiveMembership, financialContext } from "./service-context";


export class SettlementApplicationService {
  constructor(private readonly deps: Dependencies) {}

  private async pageForActor(
    household: HouseholdId,
    actor: UserId,
  ): Promise<SettlementPageView> {
    await requireActiveMembership(this.deps.repositories, household, actor);
    const context = await financialContext(this.deps.repositories, household);
    const profiles = await this.deps.repositories.profiles.getByIds(
      context.memberships.map((membership) => membership.userId),
    );
    const recommendations = generateSettlementRecommendations(context.sheet);
    return buildSettlementPageView({
      householdId: household,
      actorId: actor,
      sheet: context.sheet,
      recommendations,
      settlements: context.settlements,
      memberships: context.memberships,
      profiles,
    });
  }

  async getSettlementPage(household: HouseholdId): Promise<SettlementPageView> {
    const actor = await this.deps.session.getCurrentUserId();
    return this.pageForActor(household, actor);
  }

  async getPendingSettlementActionPreview(id: SettlementId): Promise<PendingSettlementView> {
    const actor = await this.deps.session.getCurrentUserId();
    const current = await this.deps.repositories.settlements.getById(id);
    if (
      !current ||
      current.status !== "pending" ||
      (current.senderId !== actor && current.receiverId !== actor)
    ) {
      throw new ApplicationError("NOT_FOUND", "Pending settlement not found.");
    }
    return buildPendingSettlementActionPreview(
      await this.pageForActor(current.householdId, actor),
      id,
    );
  }

  async recommendations(household: HouseholdId): Promise<readonly SettlementRecommendation[]> {
    const actor = await this.deps.session.getCurrentUserId();
    await requireActiveMembership(this.deps.repositories, household, actor);
    return generateSettlementRecommendations(
      (await financialContext(this.deps.repositories, household)).sheet,
    );
  }

  async listHouseholdSettlements(household: HouseholdId) {
    const actor = await this.deps.session.getCurrentUserId();
    await requireActiveMembership(this.deps.repositories, household, actor);
    return this.deps.repositories.settlements.listByHousehold(household);
  }

  async countCurrentUserSettlementActions(): Promise<number> {
    const actor = await this.deps.session.getCurrentUserId();
    const membership = await this.deps.repositories.memberships.findActiveByUser(actor);
    if (!membership) return 0;
    return (await this.deps.repositories.settlements.listByHousehold(membership.householdId))
      .filter((item) => item.status === "pending" && item.receiverId === actor)
      .length;
  }

  async createSettlement(requested: SettlementRecommendation, requestedCommandId?: CommandId): Promise<SettlementId> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId = requestedCommandId ?? commandId(this.deps.values.nextId("command"));
    const idempotency: IdempotencyDescriptor = { actorId: actor, commandType: "create-pending-settlement", commandId: activeCommandId, intentDigest: canonicalIntentDigest(requested) };
    const replay = await this.deps.repositories.commandOutcomes.get(idempotency);
    if (replay) {
      assertIdempotentIntent(replay, idempotency);
      const replayed = await this.deps.repositories.settlements.getById(settlementId(replay.resourceId));
      if (!replayed || replayed.senderId !== actor) throw new ApplicationError("NOT_FOUND", "Settlement not found.");
      await requireActiveMembership(this.deps.repositories, replayed.householdId, actor);
      return replayed.settlementId;
    }
    const context = await financialContext(this.deps.repositories, requested.householdId);
    const now = this.deps.values.now();
    const created = createPendingSettlement({
      settlementId: settlementId(this.deps.values.nextId("settlement")),
      householdId: requested.householdId,
      actorId: actor,
      requestedRecommendation: requested,
      createdAt: now,
      memberships: context.memberships,
      currentRecommendations: generateSettlementRecommendations(context.sheet),
      existingSettlements: context.settlements,
    });
    const resourceId = await this.deps.atomic.createSettlement({
      settlement: created,
      idempotency,
      auditEvent: event(
        this.deps.values,
        requested.householdId,
        actor,
        "settlement",
        created.settlementId,
        "created-pending",
        ["status", "amount"],
        now,
      ),
    });
    const committed = await this.deps.repositories.settlements.getById(settlementId(resourceId));
    if (!committed || committed.senderId !== actor) throw new ApplicationError("NOT_FOUND", "Settlement not found.");
    await requireActiveMembership(this.deps.repositories, committed.householdId, actor);
    return committed.settlementId;
  }

  async transitionSettlement(
    id: SettlementId,
    status: Exclude<SettlementStatus, "pending">,
    requestedCommandId?: CommandId,
  ): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId = requestedCommandId ?? commandId(this.deps.values.nextId("command"));
    const commandType = status === "confirmed" ? "confirm-settlement" : status === "rejected" ? "reject-settlement" : "cancel-settlement";
    const delivery: IdempotencyDescriptor = { actorId: actor, commandType, commandId: activeCommandId, intentDigest: canonicalIntentDigest({ settlementId: id, status }) };
    const replay = await this.deps.repositories.commandOutcomes.get(delivery);
    if (replay) {
      assertIdempotentIntent(replay, delivery);
      if (replay.resourceId !== id) throw new ApplicationError("NOT_FOUND", "Settlement not found.");
      return;
    }
    const current = await this.deps.repositories.settlements.getById(id);
    if (!current) throw new ApplicationError("NOT_FOUND", "Settlement not found.");
    await requireActiveMembership(this.deps.repositories, current.householdId, actor);
    const now = this.deps.values.now();
    const updated = status === "confirmed"
      ? confirmSettlement(current, actor, now)
      : status === "rejected"
        ? rejectSettlement(current, actor, now)
        : cancelSettlement(current, actor, now);
    await this.deps.atomic.transitionSettlement({
      settlement: updated,
      expectedStatus: "pending",
      auditEvent: event(
        this.deps.values,
        current.householdId,
        actor,
        "settlement",
        id,
        status,
        ["status", "resolvedAt"],
      ),
    });
  }

  async confirmSettlement(id: SettlementId): Promise<void> {
    return this.transitionSettlement(id, "confirmed");
  }

  async rejectSettlement(id: SettlementId): Promise<void> {
    return this.transitionSettlement(id, "rejected");
  }

  async cancelSettlement(id: SettlementId): Promise<void> {
    return this.transitionSettlement(id, "cancelled");
  }
}
