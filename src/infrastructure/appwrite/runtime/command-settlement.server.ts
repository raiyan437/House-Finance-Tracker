import "server-only";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { ApplicationError } from "@/application/errors/application-error";
import { generateSettlementRecommendations } from "@/domain/balances/settlement-recommendations";
import { canonicalIntentDigest } from "@/application/idempotency/command-idempotency";

import { createPendingSettlement } from "@/domain/settlements/pending-settlement-policy";
import { cancelSettlement, confirmSettlement, rejectSettlement } from "@/domain/settlements/settlement-lifecycle";
import { mapSettlement } from "../reads/mappers.server";
import { settlementPairKey } from "../reads/read-repositories.server";
import { runCommandTransaction } from "./tx-runner.server";
import { CommandGuardEngine } from "./guards.server";
import { notificationDraft, formatNotificationBdt } from "@/application/notifications/notification-policy";
import { AppwriteCommandContext, TABLE } from "./command-context.server";

/** settlement commands retain their original complete transaction boundaries. */
export class AppwriteSettlementCommands implements Pick<AtomicApplicationPersistence, "createSettlement" | "transitionSettlement"> {
  constructor(private readonly context: AppwriteCommandContext) {}

// -- R3E: exact-recommendation Settlements -------------------------------

  async createSettlement(input: Parameters<AtomicApplicationPersistence["createSettlement"]>[0]): Promise<string> {
    const tablesDB = this.context.tablesDB;
    const { settlement, auditEvent, idempotency } = input;
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(settlement.senderId), intentSeed: { ...settlement.originatingRecommendation } },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.context.scoped(tablesDB, tx);
        if (await tables.getRow(TABLE.settlements, String(settlement.settlementId))) {
          throw new ApplicationError("CONFLICT", "Settlement already exists.");
        }
        await this.context.getAliveHousehold(tables, String(settlement.householdId));
        const context = await this.context.financialContext(tables, String(settlement.householdId));
        const actorMembership = context.memberships.find((membership) =>
          membership.userId === settlement.senderId && membership.status === "active");
        if (!actorMembership) throw new ApplicationError("NOT_FOUND", "Active household membership not found.");
        const authoritative = createPendingSettlement({
          settlementId: settlement.settlementId,
          householdId: settlement.householdId,
          actorId: settlement.senderId,
          requestedRecommendation: settlement.originatingRecommendation,
          createdAt: settlement.createdAt,
          memberships: context.memberships,
          currentRecommendations: generateSettlementRecommendations(context.sheet),
          existingSettlements: context.settlements,
        });
        if (
          authoritative.senderId !== settlement.senderId ||
          authoritative.receiverId !== settlement.receiverId ||
          authoritative.amount !== settlement.amount ||
          authoritative.status !== "pending" ||
          auditEvent.householdId !== settlement.householdId ||
          auditEvent.actorId !== settlement.senderId ||
          auditEvent.aggregateType !== "settlement" ||
          auditEvent.aggregateId !== settlement.settlementId
        ) {
          throw new ApplicationError("CONFLICT", "Settlement intent or audit metadata is inconsistent.");
        }
        const pairKey = settlementPairKey(settlement.householdId, settlement.senderId, settlement.receiverId);
        const guards = new CommandGuardEngine(tablesDB, tx, settlement.createdAt);
        await guards.touch("financial", String(settlement.householdId));
        await guards.acquire("pending-settlement", pairKey, String(settlement.settlementId));
        await tablesDB.createRow({
          databaseId: "hft",
          tableId: TABLE.settlements,
          rowId: String(settlement.settlementId),
          data: {
            householdId: String(authoritative.householdId),
            senderId: String(authoritative.senderId),
            receiverId: String(authoritative.receiverId),
            amountPoisha: authoritative.amount,
            originalAmountPoisha: authoritative.originatingRecommendation.amount,
            status: "pending",
            pairKey,
            recommendationDigest: canonicalIntentDigest(authoritative.originatingRecommendation),
            resolvedAt: null,
            createdAt: authoritative.createdAt,
          },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        await this.context.stageAudit(tablesDB, tx, auditEvent);
        await this.context.stageNotifications(tablesDB, tx, [notificationDraft({ eventKey: String(idempotency.commandId), recipientUserId: settlement.receiverId, type: "settlement-requested", title: "Settlement requested", body: `${await this.context.notificationName(tables, String(settlement.senderId))} requested a ${formatNotificationBdt(settlement.amount)} settlement`, createdAt: settlement.createdAt as never, householdId: settlement.householdId, entityType: "settlement", entityId: settlement.settlementId })]);
        await this.context.stageOutcome(tablesDB, tx, idempotency, String(settlement.settlementId), settlement.createdAt);
        this.context.lastR3StagedOperations.createSettlement = tx.stagedOperations();
        return String(settlement.settlementId);
      }),
      (resourceId) => resourceId,
      idempotency,
    );
  }

async transitionSettlement(input: Parameters<AtomicApplicationPersistence["transitionSettlement"]>[0]): Promise<void> {
    const tablesDB = this.context.tablesDB;
    const proposed = input.settlement;
    const actorId = input.auditEvent.actorId;
    const intentSeed = { settlementId: String(proposed.settlementId), status: proposed.status };
    return this.context.resolveDelivery(
      tablesDB,
      { actorId: String(actorId), intentSeed },
      async () => runCommandTransaction(tablesDB, async ({ tx }) => {
        const tables = this.context.scoped(tablesDB, tx);
        const raw = await tables.getRow(TABLE.settlements, String(proposed.settlementId));
        const current = raw ? mapSettlement(raw) : undefined;
        if (!current) throw new ApplicationError("NOT_FOUND", "Settlement not found.");
        await this.context.getAliveHousehold(tables, String(current.householdId));
        const context = await this.context.financialContext(tables, String(current.householdId));
        if (!context.memberships.some((membership) => membership.userId === actorId && membership.status === "active")) {
          throw new ApplicationError("NOT_FOUND", "Settlement not found.");
        }
        if (current.status !== input.expectedStatus || input.expectedStatus !== "pending") {
          throw new ApplicationError("CONFLICT", "Settlement is no longer Pending.");
        }
        if (proposed.status === "pending" || !proposed.resolvedAt) {
          throw new ApplicationError("CONFLICT", "Settlement transition is inconsistent.");
        }
        const authoritative = proposed.status === "confirmed"
          ? confirmSettlement(current, actorId, proposed.resolvedAt)
          : proposed.status === "rejected"
            ? rejectSettlement(current, actorId, proposed.resolvedAt)
            : cancelSettlement(current, actorId, proposed.resolvedAt);
        if (
          authoritative.householdId !== proposed.householdId ||
          authoritative.senderId !== proposed.senderId ||
          authoritative.receiverId !== proposed.receiverId ||
          authoritative.amount !== proposed.amount ||
          authoritative.status !== proposed.status ||
          input.auditEvent.householdId !== current.householdId ||
          input.auditEvent.aggregateType !== "settlement" ||
          input.auditEvent.aggregateId !== current.settlementId
        ) {
          throw new ApplicationError("CONFLICT", "Settlement transition metadata is inconsistent.");
        }
        const pairKey = settlementPairKey(current.householdId, current.senderId, current.receiverId);
        const guards = new CommandGuardEngine(tablesDB, tx, proposed.resolvedAt);
        await guards.touch("financial", String(current.householdId));
        await guards.release("pending-settlement", pairKey, String(current.settlementId));
        await tablesDB.updateRow({
          databaseId: "hft",
          tableId: TABLE.settlements,
          rowId: String(current.settlementId),
          data: { status: authoritative.status, resolvedAt: authoritative.resolvedAt },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        await this.context.stageAudit(tablesDB, tx, input.auditEvent);
        const transitionTarget = authoritative.status === "cancelled" ? authoritative.receiverId : authoritative.senderId;
        const transitionName = await this.context.notificationName(tables, String(actorId));
        const transitionType = authoritative.status === "confirmed" ? "settlement-confirmed" : authoritative.status === "rejected" ? "settlement-rejected" : "settlement-cancelled";
        const transitionVerb = authoritative.status === "confirmed" ? "confirmed" : authoritative.status === "rejected" ? "rejected" : "cancelled";
        await this.context.stageNotifications(tablesDB, tx, [notificationDraft({ eventKey: String(input.auditEvent.auditEventId), recipientUserId: transitionTarget, type: transitionType, title: `Settlement ${transitionVerb}`, body: `${transitionName} ${transitionVerb} your ${formatNotificationBdt(authoritative.amount)} settlement`, createdAt: authoritative.resolvedAt as never, householdId: authoritative.householdId, entityType: "settlement", entityId: authoritative.settlementId })]);
        await this.context.stageEnvelopeOutcome(tablesDB, tx, String(actorId), intentSeed, String(current.settlementId), proposed.resolvedAt);
        this.context.lastR3StagedOperations[`settlement-${authoritative.status}`] = tx.stagedOperations();
      }),
      () => undefined,
    );
  }
}
