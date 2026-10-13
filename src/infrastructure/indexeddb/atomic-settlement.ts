import { ApplicationError } from "@/application/errors/application-error";
import { assertIdempotentIntent, commandOutcomeKey } from "@/application/idempotency/command-idempotency";
import { notificationDraft, formatNotificationBdt } from "@/application/notifications/notification-policy";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import { calculateHouseholdBalances } from "@/domain/balances/calculate-household-balances";
import { assertHouseholdFinancialState } from "@/domain/balances/household-financial-state";
import { generateSettlementRecommendations } from "@/domain/balances/settlement-recommendations";
import { DomainError } from "@/domain/shared/domain-error";
import { toBalanceExpense } from "@/domain/records/domain-records";

import { createPendingSettlement } from "@/domain/settlements/pending-settlement-policy";
import { assertSettlementIdentityUnchanged, persistenceFailure } from "./repositories";
import { fromCommandOutcomeRecord, fromExpenseRecord, fromMembershipRecord, fromSettlementRecord, toAuditRecord, toCommandOutcomeRecord, toSettlementRecord } from "./mappers";
import { IndexedDbCommandContext, abortSafely, notificationActorName, stageNotifications } from "./atomic-context";

/** settlement commands retain their original complete transaction boundaries. */
export class IndexedDbSettlementCommands implements Pick<AtomicApplicationPersistence, "createSettlement" | "transitionSettlement"> {
  constructor(private readonly context: IndexedDbCommandContext) {}

async createSettlement(input: Parameters<AtomicApplicationPersistence["createSettlement"]>[0]): Promise<string> {
    if (input.settlement.status !== "pending") throw new ApplicationError("CONFLICT", "New settlements must be Pending.");
    if (
      input.auditEvent.householdId !== input.settlement.householdId ||
      input.auditEvent.actorId !== input.settlement.senderId ||
      input.auditEvent.aggregateType !== "settlement" ||
      input.auditEvent.aggregateId !== input.settlement.settlementId
    ) {
      throw new ApplicationError("CONFLICT", "Settlement creation audit context is inconsistent.");
    }
    if (input.idempotency.actorId !== input.settlement.senderId || input.idempotency.commandType !== "create-pending-settlement") throw new ApplicationError("CONFLICT", "Settlement command identity is inconsistent.");
    const tx = (await this.context.db()).transaction(
      ["memberships", "expenses", "settlements", "userProfiles", "notifications", "auditEvents", "commandOutcomes"],
      "readwrite",
    );
    try {
      const outcomeKey = commandOutcomeKey(input.idempotency);
      const existingRaw = await tx.objectStore("commandOutcomes").get(outcomeKey);
      if (existingRaw) {
        const existing = fromCommandOutcomeRecord(existingRaw, outcomeKey);
        assertIdempotentIntent(existing, input.idempotency);
        await tx.done;
        return existing.resourceId;
      }
      const [membershipRows, expenseRows, settlementRows] = await Promise.all([
        tx.objectStore("memberships").index("householdId").getAll(input.settlement.householdId),
        tx.objectStore("expenses").index("householdId").getAll(input.settlement.householdId),
        tx.objectStore("settlements").index("householdId").getAll(input.settlement.householdId),
      ]);
      const memberships = membershipRows.map((row) => fromMembershipRecord(row, row.key));
      const expenses = expenseRows.map((row) => fromExpenseRecord(row, row.id));
      const settlements = settlementRows.map((row) => fromSettlementRecord(row, row.id));
      const sheet = calculateHouseholdBalances(
        input.settlement.householdId,
        memberships,
        expenses.map(toBalanceExpense),
        settlements,
      );
      const revalidated = createPendingSettlement({
        settlementId: input.settlement.settlementId,
        householdId: input.settlement.householdId,
        actorId: input.auditEvent.actorId,
        requestedRecommendation: input.settlement.originatingRecommendation,
        createdAt: input.settlement.createdAt,
        memberships,
        currentRecommendations: generateSettlementRecommendations(sheet),
        existingSettlements: settlements,
      });
      assertSettlementIdentityUnchanged(revalidated, input.settlement);
      await tx.objectStore("settlements").add(toSettlementRecord(revalidated));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      await tx.objectStore("commandOutcomes").add(toCommandOutcomeRecord({ ...input.idempotency, resourceId: input.settlement.settlementId, completedAt: input.auditEvent.occurredAt }));
      const name = await notificationActorName(tx, input.settlement.senderId);
      await stageNotifications(tx, [notificationDraft({ eventKey: input.idempotency.commandId, recipientUserId: input.settlement.receiverId, type: "settlement-requested", title: "Settlement requested", body: `${name} requested a ${formatNotificationBdt(input.settlement.amount)} settlement`, createdAt: input.settlement.createdAt, householdId: input.settlement.householdId, entityType: "settlement", entityId: input.settlement.settlementId })]);
      await tx.done;
      return input.settlement.settlementId;
    } catch (error) {
      abortSafely(tx);
      if (error instanceof DomainError) {
        if (
          error.code === "SETTLEMENT_NOT_RECOMMENDED" ||
          error.code === "SETTLEMENT_AMOUNT_MISMATCH"
        ) {
          throw new ApplicationError(
            "CONFLICT",
            "Settlement recommendation changed. Refresh and try again.",
          );
        }
        if (error.code === "DUPLICATE_PENDING_SETTLEMENT") {
          throw new ApplicationError(
            "CONFLICT",
            "A Pending payment already exists between these members.",
          );
        }
      }
      persistenceFailure(error);
    }
  }

async transitionSettlement(input: Parameters<AtomicApplicationPersistence["transitionSettlement"]>[0]): Promise<void> {
    if (input.expectedStatus !== "pending" || input.settlement.status === "pending") throw new ApplicationError("CONFLICT", "Settlement transitions must start from Pending and become terminal.");
    const tx = (await this.context.db()).transaction(["memberships", "expenses", "settlements", "userProfiles", "notifications", "auditEvents"], "readwrite");
    try {
      const raw = await tx.objectStore("settlements").get(input.settlement.settlementId);
      if (!raw) throw new ApplicationError("NOT_FOUND", "Settlement not found.");
      const existing = fromSettlementRecord(raw, input.settlement.settlementId);
      if (existing.status === "confirmed") throw new DomainError("CONFIRMED_SETTLEMENT_IMMUTABLE", "A confirmed settlement is immutable financial history.");
      if (existing.status !== input.expectedStatus) throw new ApplicationError("CONFLICT", "Settlement status changed before transition.");
      assertSettlementIdentityUnchanged(existing, input.settlement);
      if (input.settlement.status === "confirmed") {
        const [membershipRows, expenseRows, settlementRows] = await Promise.all([
          tx.objectStore("memberships").index("householdId").getAll(input.settlement.householdId),
          tx.objectStore("expenses").index("householdId").getAll(input.settlement.householdId),
          tx.objectStore("settlements").index("householdId").getAll(input.settlement.householdId),
        ]);
        assertHouseholdFinancialState(
          input.settlement.householdId,
          membershipRows.map((row) => fromMembershipRecord(row, row.key)),
          expenseRows.map((row) => fromExpenseRecord(row, row.id)),
          settlementRows.map((row) => row.id === input.settlement.settlementId ? input.settlement : fromSettlementRecord(row, row.id)),
        );
      }
      await tx.objectStore("settlements").put(toSettlementRecord(input.settlement));
      await tx.objectStore("auditEvents").add(toAuditRecord(input.auditEvent));
      const target = input.settlement.status === "cancelled" ? input.settlement.receiverId : input.settlement.senderId;
      const name = await notificationActorName(tx, input.auditEvent.actorId);
      const type = input.settlement.status === "confirmed" ? "settlement-confirmed" : input.settlement.status === "rejected" ? "settlement-rejected" : "settlement-cancelled";
      const verb = input.settlement.status === "confirmed" ? "confirmed" : input.settlement.status === "rejected" ? "rejected" : "cancelled";
      await stageNotifications(tx, [notificationDraft({ eventKey: input.auditEvent.auditEventId, recipientUserId: target, type, title: `Settlement ${verb}`, body: `${name} ${verb} your ${formatNotificationBdt(input.settlement.amount)} settlement`, createdAt: input.settlement.resolvedAt ?? input.auditEvent.occurredAt, householdId: input.settlement.householdId, entityType: "settlement", entityId: input.settlement.settlementId })]);
      await tx.done;
    } catch (error) { abortSafely(tx); persistenceFailure(error); }
  }
}
