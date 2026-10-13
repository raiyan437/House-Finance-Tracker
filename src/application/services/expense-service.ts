import { ApplicationError } from "../errors/application-error";
import {
  expenseRelevantIntentDigest,
  type BackdatedExpenseConfirmationPayload,
} from "../expenses/backdated-expense-confirmation";
import {
  assertIdempotentIntent,
  binaryContentDigest,
  canonicalIntentDigest,
  type IdempotencyDescriptor,
} from "../idempotency/command-idempotency";
import { validateReceiptContent } from "../receipts/receipt-content-validation";
import {
  assertConfirmedSettlementFinancialChangeAllowed,
  latestConfirmedSettlementAt,
} from "@/domain/expenses/confirmed-settlement-financial-lock";
import {
  assertFormerMemberChangeAllowed,
  assertLegacyPercentageChangeAllowed,
} from "@/domain/expenses/expense-financial-fingerprint";
import { DomainError } from "@/domain/shared/domain-error";
import { markReceiptContentUserDeleted } from "@/domain/receipts/receipt-content-lifecycle";
import {
  assertCanDeleteExpense,
  assertCanEditExpense,
  assertCanViewExpense,
  getExpensePermissions,
} from "@/domain/permissions/expense-permissions";
import {
  applyExpensePaymentEdit,
  type PaymentEditRequest,
} from "@/domain/permissions/card-payment-privacy";
import {
  assertExpense,
  assertExpenseComment,
  assertReceiptMetadata,
  normalizeExpenseCommentBody,
  type Expense,
  type ExpenseComment,
  type ReceiptMetadata,
} from "@/domain/records/domain-records";
import {
  expenseCommentId,
  expenseId,
  receiptId,
  type CardId,
  type ExpenseId,
  type HouseholdId,
} from "@/domain/shared/identifiers";
import { commandId, type CommandId } from "@/domain/shared/identifiers";
import type { ExpenseDate } from "@/domain/dates/expense-date";
import { expenseIconCategory } from "@/domain/expenses/expense-icon-category";
import {
  assertExpenseDateWithinEntryWindow,
  businessDateAt,
} from "@/domain/dates/business-calendar";
import {
  isBackdatedAfterSettlement,
  latestConfirmedSettlementBefore,
} from "@/domain/expenses/backdated-expense-policy";
import { expenseFinancialFingerprintsEqual } from "@/domain/expenses/expense-financial-fingerprint";
import {
  type Dependencies,
  event,
  requireActiveMembership,
} from "./service-context";
import type {
  CreateExpenseCommand,
  ExpenseView,
  ExpenseCommentView,
  ExpenseMemberView,
  ExpenseActivityView,
  EditExpenseCommand,
} from "./expense-types";
import {
  requireBackdatedConfirmation,
  expensePrivateReference,
  financialFingerprint,
  assertExpenseParticipantsBelongToHousehold,
} from "./expense-policy";
import { projectExpenseView } from "./expense-projection";
import { indexConfirmedSettlementHistory } from "@/domain/expenses/confirmed-settlement-history";

export type {
  CreateExpenseCommand,
  ExpenseView,
  ExpenseCommentView,
  ExpenseFinancialEditReason,
  ExpenseFinancialEditability,
  ExpenseMemberView,
  ExpenseActivityView,
  EditExpenseCommand,
} from "./expense-types";

export class ExpenseApplicationService {
  constructor(private readonly deps: Dependencies) {}
  currentBusinessDate(): ExpenseDate {
    return businessDateAt(this.deps.values.now());
  }

  async listHouseholdMembers(
    household: HouseholdId,
  ): Promise<readonly ExpenseMemberView[]> {
    const actor = await this.deps.session.getCurrentUserId();
    await requireActiveMembership(this.deps.repositories, household, actor);
    const memberships =
      await this.deps.repositories.memberships.listByHousehold(household);
    const profiles = await this.deps.repositories.profiles.getByIds(
      memberships.map((membership) => membership.userId),
    );
    const names = new Map(
      profiles.map((profile) => [profile.userId, profile.displayName]),
    );
    return memberships.map((membership) =>
      Object.freeze({
        userId: membership.userId,
        displayName: names.get(membership.userId) ?? "Unknown member",
        status: membership.status,
        role: membership.role,
      }),
    );
  }

  async listExpenseActivity(
    id: ExpenseId,
  ): Promise<readonly ExpenseActivityView[]> {
    const view = await this.getExpense(id);
    const audits = (
      await this.deps.repositories.auditEvents.listByHousehold(
        view.expense.householdId,
      )
    ).filter(
      (audit) => audit.aggregateType === "expense" && audit.aggregateId === id,
    );
    const profiles = await this.deps.repositories.profiles.getByIds(
      audits.map((audit) => audit.actorId),
    );
    const names = new Map(
      profiles.map((profile) => [profile.userId, profile.displayName]),
    );
    return audits.map((audit) =>
      Object.freeze({
        action: audit.action,
        actorName: names.get(audit.actorId) ?? "Unknown member",
        occurredAt: audit.occurredAt,
        changedFields: Object.freeze([...audit.changedFields]),
      }),
    );
  }
  async createExpense(command: CreateExpenseCommand): Promise<ExpenseView> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId =
      command.commandId ?? commandId(this.deps.values.nextId("command"));
    const idempotency: IdempotencyDescriptor = {
      actorId: actor,
      commandType: "create-expense",
      commandId: activeCommandId,
      intentDigest: canonicalIntentDigest({
        householdId: command.householdId,
        name: command.name.trim(),
        iconCategory: expenseIconCategory(command.iconCategory),
        amount: command.amount,
        expenseDate: command.expenseDate,
        splitMethod: command.splitMethod,
        percentageEntries: command.percentageEntries,
        allocations: command.allocations,
        payment: command.payment,
        receipts: (command.receipts ?? []).map((item) => ({
          filename: item.originalFilename?.trim(),
          mimeType: item.content.mimeType,
          sizeBytes: item.content.bytes.byteLength,
          contentDigest: binaryContentDigest(item.content.bytes),
        })),
      }),
    };
    const replay =
      await this.deps.repositories.commandOutcomes.get(idempotency);
    if (replay) {
      assertIdempotentIntent(replay, idempotency);
      return this.getExpense(expenseId(replay.resourceId));
    }
    const now = this.deps.values.now();
    await requireActiveMembership(
      this.deps.repositories,
      command.householdId,
      actor,
    );
    const memberships =
      await this.deps.repositories.memberships.listByHousehold(
        command.householdId,
      );
    const id = expenseId(this.deps.values.nextId("expense"));
    let selectedCardId: CardId | undefined;
    if (command.payment.method === "card") {
      const card = await this.deps.repositories.cards.getOwned(
        command.payment.cardId,
        actor,
      );
      if (!card || card.archivedAt)
        throw new ApplicationError("NOT_FOUND", "Selectable card not found.");
      selectedCardId = card.cardId;
    }
    if (
      command.splitMethod === "percentage" &&
      command.percentageEntries === undefined
    ) {
      throw new DomainError(
        "LEGACY_PERCENTAGE_INPUT_UNAVAILABLE",
        "New percentage expenses require their original basis-point entries.",
      );
    }
    if (
      command.splitMethod !== "percentage" &&
      command.percentageEntries !== undefined
    ) {
      throw new DomainError(
        "INVALID_EXPENSE",
        "Only percentage expenses may include percentage source entries.",
      );
    }
    assertExpenseDateWithinEntryWindow(command.expenseDate, now);
    const expense: Expense = {
      expenseId: id,
      householdId: command.householdId,
      creatorId: actor,
      payerId: actor,
      name: command.name.trim(),
      iconCategory: expenseIconCategory(command.iconCategory),
      amount: command.amount,
      expenseDate: command.expenseDate,
      splitMethod: command.splitMethod,
      ...(command.splitMethod === "percentage"
        ? { percentageEntries: command.percentageEntries }
        : {}),
      allocations: command.allocations,
      payment:
        command.payment.method === "cash"
          ? { method: "cash" }
          : { method: "card", cardReference: expensePrivateReference(id) },
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    assertExpense(expense);
    assertExpenseParticipantsBelongToHousehold(expense, memberships, true);
    const relevantIntentDigest = expenseRelevantIntentDigest({
      amount: expense.amount,
      expenseDate: expense.expenseDate,
      splitMethod: expense.splitMethod,
      percentageEntries: expense.percentageEntries,
      allocations: expense.allocations,
      paymentMethod: expense.payment.method,
      ...(selectedCardId ? { cardAssociationIdentity: selectedCardId } : {}),
    });
    const settlements =
      await this.deps.repositories.settlements.listByHousehold(
        command.householdId,
      );
    const backdatedBoundary = latestConfirmedSettlementBefore(
      command.householdId,
      now,
      settlements,
    );
    if (isBackdatedAfterSettlement(expense.expenseDate, backdatedBoundary)) {
      const payload = {
        actorId: actor,
        commandType: "create-expense",
        commandId: activeCommandId,
        relevantIntentDigest,
        proposedExpenseDate: expense.expenseDate,
        qualifyingSettlementId: backdatedBoundary!.settlementId,
        qualifyingSettlementResolvedAt: backdatedBoundary!.resolvedAt,
      } satisfies BackdatedExpenseConfirmationPayload;
      requireBackdatedConfirmation(
        this.deps,
        payload,
        command.backdatedConfirmationToken,
      );
    }
    await Promise.all(
      (command.receipts ?? []).map((item) =>
        validateReceiptContent(item.content, this.deps.receiptContentDecoder),
      ),
    );
    const receipts = (command.receipts ?? []).map((item) => {
      const metadata: ReceiptMetadata = {
        receiptId: receiptId(this.deps.values.nextId("receipt")),
        householdId: command.householdId,
        expenseId: id,
        createdByUserId: actor,
        mimeType: item.content.mimeType,
        ...(item.originalFilename
          ? { originalFilename: item.originalFilename.trim() }
          : {}),
        sizeBytes: item.content.bytes.byteLength,
        createdAt: now,
        contentStatus: "available",
      };
      assertReceiptMetadata(metadata);
      return { metadata, content: item.content };
    });
    const resourceId = await this.deps.atomic.createExpense({
      expense,
      actorId: actor,
      commandId: activeCommandId,
      idempotency,
      relevantIntentDigest,
      ...(command.backdatedConfirmationToken
        ? { backdatedConfirmationToken: command.backdatedConfirmationToken }
        : {}),
      ...(selectedCardId ? { selectedCardId } : {}),
      receipts,
      auditEvent: event(
        this.deps.values,
        command.householdId,
        actor,
        "expense",
        id,
        "created",
        [
          "name",
          "iconCategory",
          "amount",
          "expenseDate",
          "allocations",
          "payment",
          ...(receipts.length ? ["receipts"] : []),
        ],
        now,
      ),
    });
    return this.getExpense(expenseId(resourceId));
  }

  async getExpense(id: ExpenseId): Promise<ExpenseView> {
    const actor = await this.deps.session.getCurrentUserId();
    const expense = await this.deps.repositories.expenses.getById(id);
    if (!expense) throw new ApplicationError("NOT_FOUND", "Expense not found.");
    const [memberships, settlements, counts] = await Promise.all([
      this.deps.repositories.memberships.listByHousehold(expense.householdId),
      this.deps.repositories.settlements.listByHousehold(expense.householdId),
      this.deps.repositories.expenseComments.countForExpenses(
        expense.householdId,
        [id],
      ),
    ]);
    assertCanViewExpense(
      getExpensePermissions(
        expense.householdId,
        actor,
        expense.creatorId,
        memberships,
      ),
    );
    const snapshot =
      actor === expense.creatorId && expense.payment.method === "card"
        ? await this.deps.repositories.expenses.getPrivateCardSnapshot(
            id,
            actor,
          )
        : undefined;
    return projectExpenseView(
      expense,
      actor,
      memberships,
      settlements,
      snapshot,
      counts.get(id) ?? 0,
    );
  }

  async listHouseholdExpenses(
    household: HouseholdId,
    includeDeleted = false,
  ): Promise<readonly ExpenseView[]> {
    const actor = await this.deps.session.getCurrentUserId();
    await requireActiveMembership(this.deps.repositories, household, actor);
    const [history, memberships, settlements] = await Promise.all([
      this.deps.repositories.expenses.listHouseholdHistory(household),
      this.deps.repositories.memberships.listByHousehold(household),
      this.deps.repositories.settlements.listByHousehold(household),
    ]);
    const visible = includeDeleted
      ? history
      : history.filter((expense) => !expense.deletedAt);
    const counts =
      await this.deps.repositories.expenseComments.countForExpenses(
        household,
        visible.map((expense) => expense.expenseId),
      );
    const confirmedHistory = visible.length
      ? indexConfirmedSettlementHistory(household, settlements)
      : undefined;
    return Promise.all(
      visible.map(async (expense) =>
        projectExpenseView(
          expense,
          actor,
          memberships,
          settlements,
          actor === expense.creatorId && expense.payment.method === "card"
            ? await this.deps.repositories.expenses.getPrivateCardSnapshot(
                expense.expenseId,
                actor,
              )
            : undefined,
          counts.get(expense.expenseId) ?? 0,
          confirmedHistory,
        ),
      ),
    );
  }

  async listExpenseComments(
    id: ExpenseId,
  ): Promise<readonly ExpenseCommentView[]> {
    const actor = await this.deps.session.getCurrentUserId();
    const expense = await this.deps.repositories.expenses.getById(id);
    if (!expense) throw new ApplicationError("NOT_FOUND", "Expense not found.");
    const household = await this.deps.repositories.households.getById(
      expense.householdId,
    );
    if (!household || household.deletedAt)
      throw new ApplicationError("NOT_FOUND", "Expense not found.");
    await requireActiveMembership(
      this.deps.repositories,
      expense.householdId,
      actor,
    );
    const comments =
      await this.deps.repositories.expenseComments.listForExpense(id);
    const profiles = await this.deps.repositories.profiles.getByIds(
      comments.map((comment) => comment.authorUserId),
    );
    const names = new Map(
      profiles.map((profile) => [profile.userId, profile.displayName]),
    );
    return comments.map((comment) =>
      Object.freeze({
        commentId: comment.commentId,
        authorUserId: comment.authorUserId,
        authorDisplayName: names.get(comment.authorUserId) ?? "Former member",
        body: comment.body,
        createdAt: comment.createdAt,
      }),
    );
  }

  async createExpenseComment(
    id: ExpenseId,
    bodyInput: string,
    requestedCommandId: CommandId,
  ): Promise<ExpenseCommentView> {
    const actor = await this.deps.session.getCurrentUserId();
    const expense = await this.deps.repositories.expenses.getById(id);
    if (!expense || expense.deletedAt)
      throw new ApplicationError("NOT_FOUND", "Expense not found.");
    const household = await this.deps.repositories.households.getById(
      expense.householdId,
    );
    if (!household || household.deletedAt)
      throw new ApplicationError("NOT_FOUND", "Expense not found.");
    await requireActiveMembership(
      this.deps.repositories,
      expense.householdId,
      actor,
    );
    const body = normalizeExpenseCommentBody(bodyInput);
    const descriptor: IdempotencyDescriptor = {
      actorId: actor,
      commandType: "create-expense-comment",
      commandId: requestedCommandId,
      intentDigest: canonicalIntentDigest({ expenseId: id, body }),
    };
    const replay = await this.deps.repositories.commandOutcomes.get(descriptor);
    if (replay) {
      assertIdempotentIntent(replay, descriptor);
      const existing = (
        await this.deps.repositories.expenseComments.listForExpense(id)
      ).find((comment) => comment.commentId === replay.resourceId);
      if (!existing)
        throw new ApplicationError(
          "PERSISTENCE_FAILURE",
          "Stored comment outcome could not be reconstructed.",
        );
      const profile = await this.deps.repositories.profiles.getByIds([
        existing.authorUserId,
      ]);
      return Object.freeze({
        commentId: existing.commentId,
        authorUserId: existing.authorUserId,
        authorDisplayName: profile[0]?.displayName ?? "Former member",
        body: existing.body,
        createdAt: existing.createdAt,
      });
    }
    const comment: ExpenseComment = {
      commentId: expenseCommentId(this.deps.values.nextId("expense-comment")),
      householdId: expense.householdId,
      expenseId: id,
      authorUserId: actor,
      body,
      createdAt: this.deps.values.now(),
    };
    assertExpenseComment(comment);
    await this.deps.atomic.createExpenseComment({
      comment,
      idempotency: descriptor,
    });
    const profile = await this.deps.repositories.profiles.getByIds([actor]);
    return Object.freeze({
      commentId: comment.commentId,
      authorUserId: actor,
      authorDisplayName: profile[0]?.displayName ?? "Household member",
      body,
      createdAt: comment.createdAt,
    });
  }

  async editExpense(command: EditExpenseCommand): Promise<ExpenseView> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId =
      command.commandId ?? commandId(this.deps.values.nextId("command"));
    const editIntent = Object.fromEntries(
      Object.entries(command).filter(([key]) => key !== "commandId"),
    );
    const delivery: IdempotencyDescriptor = {
      actorId: actor,
      commandType: "edit-expense",
      commandId: activeCommandId,
      intentDigest: canonicalIntentDigest(editIntent),
    };
    const replay = await this.deps.repositories.commandOutcomes.get(delivery);
    if (replay) {
      assertIdempotentIntent(replay, delivery);
      if (replay.resourceId !== command.expenseId)
        throw new ApplicationError("NOT_FOUND", "Expense not found.");
      return this.getExpense(command.expenseId);
    }
    const original = await this.deps.repositories.expenses.getById(
      command.expenseId,
    );
    if (!original || original.deletedAt)
      throw new ApplicationError("NOT_FOUND", "Expense not found.");
    const [memberships, settlements] = await Promise.all([
      this.deps.repositories.memberships.listByHousehold(original.householdId),
      this.deps.repositories.settlements.listByHousehold(original.householdId),
    ]);
    assertCanEditExpense(
      getExpensePermissions(
        original.householdId,
        actor,
        original.creatorId,
        memberships,
      ),
    );
    if (command.expectedRevision !== original.revision) {
      throw new ApplicationError(
        "EXPENSE_VERSION_CONFLICT",
        "This expense changed while you were editing it.",
      );
    }
    if (
      command.splitMethod !== "percentage" &&
      command.percentageEntries !== undefined
    ) {
      throw new DomainError(
        "INVALID_EXPENSE",
        "Only percentage expenses may include percentage source entries.",
      );
    }
    const existingSnapshot =
      actor === original.creatorId
        ? await this.deps.repositories.expenses.getPrivateCardSnapshot(
            original.expenseId,
            actor,
          )
        : undefined;
    if (
      actor === original.creatorId &&
      original.payment.method === "card" &&
      !existingSnapshot
    ) {
      throw new ApplicationError(
        "PERSISTENCE_FAILURE",
        "Card expense history could not be read before editing.",
      );
    }
    let selectedCardId: CardId | undefined;
    let paymentRequest: PaymentEditRequest;
    if (command.payment.kind === "preserve")
      paymentRequest = { kind: "preserve" };
    else if (command.payment.kind === "cash")
      paymentRequest = {
        kind: "change-to-cash",
        confirmedPrivateReferenceDetachment:
          command.payment.confirmedPrivateReferenceDetachment,
      };
    else {
      const card = await this.deps.repositories.cards.getOwned(
        command.payment.cardId,
        actor,
      );
      if (!card || card.archivedAt)
        throw new ApplicationError("NOT_FOUND", "Selectable card not found.");
      if (
        original.payment.method === "card" &&
        existingSnapshot?.cardId === card.cardId
      ) {
        paymentRequest = { kind: "preserve" };
      } else {
        selectedCardId = card.cardId;
        paymentRequest = {
          kind: "select-card",
          cardReference: expensePrivateReference(original.expenseId),
        };
      }
    }
    const payment = applyExpensePaymentEdit(
      original.householdId,
      actor,
      original.creatorId,
      memberships,
      original.payment,
      paymentRequest,
    );
    const preserveOpaquePrivateSnapshot =
      actor !== original.creatorId && payment.method === "card";
    if (
      payment.method === "card" &&
      !selectedCardId &&
      !existingSnapshot &&
      !preserveOpaquePrivateSnapshot
    )
      throw new ApplicationError(
        "CONFLICT",
        "Card expense history requires a private snapshot.",
      );
    const percentageEntries =
      command.splitMethod === "percentage"
        ? (command.percentageEntries ??
          (original.splitMethod === "percentage"
            ? original.percentageEntries
            : undefined))
        : undefined;
    if (
      command.splitMethod === "percentage" &&
      original.splitMethod !== "percentage" &&
      percentageEntries === undefined
    ) {
      throw new DomainError(
        "LEGACY_PERCENTAGE_INPUT_UNAVAILABLE",
        "Changing to a percentage split requires original basis-point entries.",
      );
    }
    const proposed: Expense = {
      ...original,
      percentageEntries: undefined,
      name: command.name.trim(),
      iconCategory: expenseIconCategory(
        command.iconCategory ?? original.iconCategory,
      ),
      amount: command.amount,
      expenseDate: command.expenseDate,
      splitMethod: command.splitMethod,
      ...(percentageEntries === undefined ? {} : { percentageEntries }),
      allocations: command.allocations,
      payment,
    };
    assertExpense(proposed);
    assertExpenseParticipantsBelongToHousehold(proposed, memberships, false);
    const originalCardAssociationIdentity =
      original.payment.method === "card"
        ? (existingSnapshot?.cardId ?? original.payment.cardReference)
        : undefined;
    const proposedCardAssociationIdentity =
      proposed.payment.method === "card"
        ? (selectedCardId ?? originalCardAssociationIdentity)
        : undefined;
    const originalFingerprint = financialFingerprint(
      original,
      originalCardAssociationIdentity,
    );
    const proposedFingerprint = financialFingerprint(
      proposed,
      proposedCardAssociationIdentity,
    );
    assertConfirmedSettlementFinancialChangeAllowed(
      originalFingerprint,
      proposedFingerprint,
      original.createdAt,
      latestConfirmedSettlementAt(original.householdId, settlements),
    );
    assertFormerMemberChangeAllowed(
      originalFingerprint,
      proposedFingerprint,
      memberships,
    );
    assertLegacyPercentageChangeAllowed(
      originalFingerprint,
      proposedFingerprint,
    );
    const financialChanged = !expenseFinancialFingerprintsEqual(
      originalFingerprint,
      proposedFingerprint,
    );
    const hasReceiptChanges = Boolean(
      command.newReceipts?.length || command.removedReceiptIds?.length,
    );
    if (
      !financialChanged &&
      proposed.name === original.name &&
      proposed.iconCategory === expenseIconCategory(original.iconCategory) &&
      !hasReceiptChanges
    ) {
      return projectExpenseView(
        original,
        actor,
        memberships,
        settlements,
        existingSnapshot,
      );
    }
    const commandInstant = this.deps.values.now();
    const dateChanged = proposed.expenseDate !== original.expenseDate;
    if (dateChanged)
      assertExpenseDateWithinEntryWindow(proposed.expenseDate, commandInstant);
    const relevantIntentDigest = expenseRelevantIntentDigest({
      amount: proposed.amount,
      expenseDate: proposed.expenseDate,
      splitMethod: proposed.splitMethod,
      percentageEntries: proposed.percentageEntries,
      allocations: proposed.allocations,
      paymentMethod: proposed.payment.method,
      ...(proposed.payment.method === "card"
        ? {
            cardAssociationIdentity:
              actor === original.creatorId
                ? proposedCardAssociationIdentity
                : "preserved-private-card",
          }
        : {}),
    });
    if (financialChanged) {
      const boundary = latestConfirmedSettlementBefore(
        original.householdId,
        commandInstant,
        settlements,
      );
      if (isBackdatedAfterSettlement(proposed.expenseDate, boundary)) {
        const payload = {
          actorId: actor,
          commandType: "edit-expense",
          commandId: activeCommandId,
          relevantIntentDigest,
          proposedExpenseDate: proposed.expenseDate,
          qualifyingSettlementId: boundary!.settlementId,
          qualifyingSettlementResolvedAt: boundary!.resolvedAt,
        } satisfies BackdatedExpenseConfirmationPayload;
        requireBackdatedConfirmation(
          this.deps,
          payload,
          command.backdatedConfirmationToken,
        );
      }
    }
    const updated: Expense = {
      ...proposed,
      revision: original.revision + 1,
      updatedAt: commandInstant,
    };
    const receiptIds = command.removedReceiptIds ?? [];
    if (
      (receiptIds.length > 0 || (command.newReceipts?.length ?? 0) > 0) &&
      actor !== original.creatorId
    ) {
      throw new ApplicationError(
        "RECEIPT_PRIVATE_ACCESS_FORBIDDEN",
        "Only the Expense creator may manage Receipts.",
      );
    }
    if (new Set(receiptIds).size !== receiptIds.length) {
      throw new ApplicationError(
        "CONFLICT",
        "A receipt cannot be removed twice in one edit.",
      );
    }
    const receiptRemovals = await Promise.all(
      receiptIds.map(async (id) => {
        const metadata = await this.deps.repositories.receipts.getMetadata(id);
        if (
          !metadata ||
          metadata.contentStatus !== "available" ||
          metadata.expenseId !== original.expenseId
        ) {
          throw new ApplicationError("NOT_FOUND", "Receipt not found.");
        }
        return markReceiptContentUserDeleted(
          metadata,
          updated.updatedAt,
          actor,
        );
      }),
    );
    await Promise.all(
      (command.newReceipts ?? []).map((item) =>
        validateReceiptContent(item.content, this.deps.receiptContentDecoder),
      ),
    );
    const receiptAdditions = (command.newReceipts ?? []).map((item) => {
      const metadata: ReceiptMetadata = {
        receiptId: receiptId(this.deps.values.nextId("receipt")),
        householdId: original.householdId,
        expenseId: original.expenseId,
        createdByUserId: actor,
        mimeType: item.content.mimeType,
        ...(item.originalFilename
          ? { originalFilename: item.originalFilename.trim() }
          : {}),
        sizeBytes: item.content.bytes.byteLength,
        createdAt: updated.updatedAt,
        contentStatus: "available",
      };
      assertReceiptMetadata(metadata);
      return { metadata, content: item.content };
    });
    const auditEvents = [
      event(
        this.deps.values,
        original.householdId,
        actor,
        "expense",
        original.expenseId,
        "edited",
        [
          "expense",
          ...(receiptAdditions.length || receiptRemovals.length
            ? ["receipts"]
            : []),
        ],
        commandInstant,
      ),
      ...receiptAdditions.map((item) =>
        event(
          this.deps.values,
          original.householdId,
          actor,
          "receipt",
          item.metadata.receiptId,
          "created",
          ["mimeType", "sizeBytes"],
          commandInstant,
        ),
      ),
      ...receiptRemovals.map((item) =>
        event(
          this.deps.values,
          original.householdId,
          actor,
          "receipt",
          item.receiptId,
          "deleted",
          ["contentStatus", "contentRemovedAt", "contentRemovedByUserId"],
          commandInstant,
        ),
      ),
    ];
    await this.deps.atomic.editExpense({
      expectedExpenseId: original.expenseId,
      expense: updated,
      actorId: actor,
      commandId: activeCommandId,
      relevantIntentDigest,
      backdatedConfirmationApplicable: true,
      ...(command.backdatedConfirmationToken
        ? { backdatedConfirmationToken: command.backdatedConfirmationToken }
        : {}),
      expectedRevision: command.expectedRevision,
      ...(selectedCardId ? { selectedCardId } : {}),
      receiptAdditions,
      receiptRemovals,
      auditEvents,
    });
    const committedSnapshot =
      actor === original.creatorId && payment.method === "card"
        ? await this.deps.repositories.expenses.getPrivateCardSnapshot(
            original.expenseId,
            actor,
          )
        : undefined;
    if (
      actor === original.creatorId &&
      payment.method === "card" &&
      !committedSnapshot
    ) {
      throw new ApplicationError(
        "PERSISTENCE_FAILURE",
        "Card expense history could not be read after editing.",
      );
    }
    const committedSettlements =
      await this.deps.repositories.settlements.listByHousehold(
        original.householdId,
      );
    return projectExpenseView(
      updated,
      actor,
      memberships,
      committedSettlements,
      committedSnapshot,
    );
  }

  async deleteExpense(
    id: ExpenseId,
    expectedRevision: number,
    requestedCommandId?: CommandId,
  ): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId =
      requestedCommandId ?? commandId(this.deps.values.nextId("command"));
    const delivery: IdempotencyDescriptor = {
      actorId: actor,
      commandType: "delete-expense",
      commandId: activeCommandId,
      intentDigest: canonicalIntentDigest({ expenseId: id, expectedRevision }),
    };
    const replay = await this.deps.repositories.commandOutcomes.get(delivery);
    if (replay) {
      assertIdempotentIntent(replay, delivery);
      if (replay.resourceId !== id)
        throw new ApplicationError("NOT_FOUND", "Expense not found.");
      return;
    }
    const original = await this.deps.repositories.expenses.getById(id);
    if (!original || original.deletedAt)
      throw new ApplicationError("NOT_FOUND", "Expense not found.");
    const [memberships, settlements] = await Promise.all([
      this.deps.repositories.memberships.listByHousehold(original.householdId),
      this.deps.repositories.settlements.listByHousehold(original.householdId),
    ]);
    assertCanDeleteExpense(
      getExpensePermissions(
        original.householdId,
        actor,
        original.creatorId,
        memberships,
      ),
    );
    if (expectedRevision !== original.revision) {
      throw new ApplicationError(
        "EXPENSE_VERSION_CONFLICT",
        "This expense changed while you were editing it.",
      );
    }
    const existingSnapshot =
      actor === original.creatorId && original.payment.method === "card"
        ? await this.deps.repositories.expenses.getPrivateCardSnapshot(
            original.expenseId,
            actor,
          )
        : undefined;
    if (
      actor === original.creatorId &&
      original.payment.method === "card" &&
      !existingSnapshot
    ) {
      throw new ApplicationError(
        "PERSISTENCE_FAILURE",
        "Card expense history could not be read before deletion.",
      );
    }
    const cardAssociationIdentity =
      original.payment.method === "card"
        ? (existingSnapshot?.cardId ?? original.payment.cardReference)
        : undefined;
    const now = this.deps.values.now();
    const deleted: Expense = {
      ...original,
      revision: original.revision + 1,
      updatedAt: now,
      deletedAt: now,
      deletedByUserId: actor,
    };
    const originalFingerprint = financialFingerprint(
      original,
      cardAssociationIdentity,
    );
    const deletedFingerprint = financialFingerprint(
      deleted,
      cardAssociationIdentity,
    );
    assertConfirmedSettlementFinancialChangeAllowed(
      originalFingerprint,
      deletedFingerprint,
      original.createdAt,
      latestConfirmedSettlementAt(original.householdId, settlements),
    );
    assertFormerMemberChangeAllowed(
      originalFingerprint,
      deletedFingerprint,
      memberships,
    );
    assertLegacyPercentageChangeAllowed(
      originalFingerprint,
      deletedFingerprint,
    );
    const relevantIntentDigest = expenseRelevantIntentDigest({
      amount: deleted.amount,
      expenseDate: deleted.expenseDate,
      splitMethod: deleted.splitMethod,
      percentageEntries: deleted.percentageEntries,
      allocations: deleted.allocations,
      paymentMethod: deleted.payment.method,
      ...(cardAssociationIdentity ? { cardAssociationIdentity } : {}),
    });
    await this.deps.atomic.editExpense({
      expectedExpenseId: original.expenseId,
      expense: deleted,
      actorId: actor,
      commandId: activeCommandId,
      relevantIntentDigest,
      backdatedConfirmationApplicable: false,
      expectedRevision,
      auditEvents: [
        event(
          this.deps.values,
          original.householdId,
          actor,
          "expense",
          id,
          "deleted",
          ["deletedAt"],
          now,
        ),
      ],
    });
  }
}
