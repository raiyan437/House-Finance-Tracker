import { ApplicationError, BackdatedExpenseConfirmationRequiredError } from "../errors/application-error";
import {
  expenseRelevantIntentDigest,
  LOCAL_BACKDATED_CONFIRMATION_AUTHORITY,
  type BackdatedExpenseConfirmationAuthority,
  type BackdatedExpenseConfirmationPayload,
} from "../expenses/backdated-expense-confirmation";
import { assertIdempotentIntent, binaryContentDigest, canonicalIntentDigest, type IdempotencyDescriptor } from "../idempotency/command-idempotency";
import { HouseholdAnalyticsApplicationService } from "../analytics/analytics-service";
import {
  validateReceiptContent,
  type ReceiptContentDecoder,
} from "../receipts/receipt-content-validation";
import type {
  AtomicApplicationPersistence,
  ApplicationRepositories,
  CurrentSession,
  ReceiptContent,
} from "../repositories";

export type ExpenseReceiptContent = ReceiptContent;
import { calculateHouseholdBalances } from "@/domain/balances/calculate-household-balances";
import { generateSettlementRecommendations } from "@/domain/balances/settlement-recommendations";
import type { CardColorId } from "@/domain/cards/card-color";
import type { CardRemovalAction, CardRemovalResult } from "@/domain/cards/card-lifecycle";
import {
  assertConfirmedSettlementFinancialChangeAllowed,
  isExpenseFinanciallyLocked,
  latestConfirmedSettlementAt,
} from "@/domain/expenses/confirmed-settlement-financial-lock";
import { assertFormerMemberChangeAllowed, assertLegacyPercentageChangeAllowed, expenseInvolvesFormerMember, type ExpenseFinancialFingerprint } from "@/domain/expenses/expense-financial-fingerprint";
import { expensePercentageSourceStatus, type ExpensePercentageSourceStatus } from "@/domain/expenses/expense-percentage-source";
import { DomainError } from "@/domain/shared/domain-error";
import { markReceiptContentUserDeleted } from "@/domain/receipts/receipt-content-lifecycle";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import { assertCanDeleteExpense, assertCanEditExpense, assertCanViewExpense, getExpensePermissions } from "@/domain/permissions/expense-permissions";
import { applyExpensePaymentEdit, projectExpensePayment, type PaymentEditRequest } from "@/domain/permissions/card-payment-privacy";
import {
  assertCard,
  assertExpense,
  assertExpenseComment,
  assertHousehold,
  assertJoinRequest,
  assertReceiptMetadata,
  assertUserProfile,
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  normalizeExpenseCommentBody,
  toBalanceExpense,
  type AuditEvent,
  type Card,
  type Expense,
  type ExpenseComment,
  type ExpenseCardPrivateSnapshot,
  type Household,
  type JoinRequest,
  type ReceiptMetadata,
  type ReceiptContentStatus,
  type UserProfile,
} from "@/domain/records/domain-records";
import { auditEventId, cardId, expenseCommentId, expenseId, householdId, joinRequestId, receiptId, settlementId, type CardId, type ExpenseId, type HouseholdId, type JoinRequestId, type ReceiptId, type SettlementId, type UserId } from "@/domain/shared/identifiers";
import { commandId, type CommandId } from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";
import { createPendingSettlement } from "@/domain/settlements/pending-settlement-policy";
import { cancelSettlement, confirmSettlement, rejectSettlement } from "@/domain/settlements/settlement-lifecycle";
import type { SettlementRecommendation, SettlementStatus } from "@/domain/settlements/settlement-types";
import type { PercentageSplitEntry, SplitAllocation, SplitMethod } from "@/domain/splits/split-types";
import type { ExpenseDate } from "@/domain/dates/expense-date";
import { expenseIconCategory, type ExpenseIconCategory } from "@/domain/expenses/expense-icon-category";
import { assertExpenseDateWithinEntryWindow, businessDateAt } from "@/domain/dates/business-calendar";
import { isBackdatedAfterSettlement, latestConfirmedSettlementBefore } from "@/domain/expenses/backdated-expense-policy";
import { expenseFinancialFingerprintsEqual } from "@/domain/expenses/expense-financial-fingerprint";
import type { PositivePoisha } from "@/domain/money/poisha";
import {
  buildCardRemovalPreview,
  projectMyCard,
  type CardPageView,
  type CardRemovalPreview,
  type MyCardSummaryView,
} from "@/application/cards/card-page";
import {
  buildPendingSettlementActionPreview,
  buildSettlementPageView,
  type PendingSettlementView,
  type SettlementPageView,
} from "@/application/settlements/settlement-page";
import {
  buildActiveHouseholdPageView,
  type ActiveHouseholdPageView,
} from "@/application/household/household-page";
export type GeneratedIdKind = "user" | "household" | "join-request" | "expense" | "expense-comment" | "settlement" | "card" | "receipt" | "audit" | "command";
export interface ApplicationValues {
  now(): IsoInstant;
  nextId(kind: GeneratedIdKind): string;
  nextHouseholdCodeCandidate(): string;
}

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

export interface Dependencies {
  readonly repositories: ApplicationRepositories;
  readonly atomic: AtomicApplicationPersistence;
  readonly session: CurrentSession;
  readonly values: ApplicationValues;
  readonly receiptContentDecoder?: ReceiptContentDecoder;
  readonly backdatedConfirmationAuthority?: BackdatedExpenseConfirmationAuthority;
}

function requireBackdatedConfirmation(
  deps: Dependencies,
  payload: BackdatedExpenseConfirmationPayload,
  providedToken: string | undefined,
): void {
  const authority = deps.backdatedConfirmationAuthority ?? LOCAL_BACKDATED_CONFIRMATION_AUTHORITY;
  if (!providedToken || !authority.verify(providedToken, payload)) {
    throw new BackdatedExpenseConfirmationRequiredError(authority.issue(payload));
  }
}

function event(values: ApplicationValues, household: HouseholdId, actor: UserId, aggregateType: AuditEvent["aggregateType"], aggregateId: string, action: string, changedFields: readonly string[], occurredAt = values.now()): AuditEvent {
  return Object.freeze({ auditEventId: auditEventId(values.nextId("audit")), householdId: household, actorId: actor, aggregateType, aggregateId, action, occurredAt, changedFields: Object.freeze([...changedFields]) });
}

function expensePrivateReference(id: ExpenseId): string { return `private:${id}`; }

async function requireActiveMembership(repositories: ApplicationRepositories, household: HouseholdId, actor: UserId): Promise<MembershipSnapshot> {
  const membership = await repositories.memberships.get(household, actor);
  if (!membership || membership.status !== "active") throw new ApplicationError("NOT_FOUND", "Active household membership not found.");
  return membership;
}

async function financialContext(repositories: ApplicationRepositories, household: HouseholdId) {
  const [memberships, expenses, settlements] = await Promise.all([
    repositories.memberships.listByHousehold(household),
    repositories.expenses.listHouseholdHistory(household),
    repositories.settlements.listByHousehold(household),
  ]);
  const sheet = calculateHouseholdBalances(household, memberships, expenses.map(toBalanceExpense), settlements);
  return { memberships, expenses, settlements, sheet };
}

export class ProfileApplicationService {
  constructor(private readonly deps: Dependencies) {}
  async getCurrentProfile(): Promise<UserProfile> { const actor = await this.deps.session.getCurrentUserId(); const profile = await this.deps.repositories.profiles.getById(actor); if (!profile) throw new ApplicationError("NOT_FOUND", "Profile not found."); return profile; }
  async updateCurrentProfile(displayNameInput: string, expectedVersion: number, commandIdValue: CommandId): Promise<UserProfile> {
    const actor = await this.deps.session.getCurrentUserId();
    const displayName = displayNameInput.trim();
    if (displayName.length > PROFILE_DISPLAY_NAME_MAX_LENGTH) {
      throw new ApplicationError("INVALID_INPUT", "Display name must be 20 characters or fewer.");
    }
    const current = await this.getCurrentProfile();
    assertUserProfile({ ...current, displayName });
    const idempotency: IdempotencyDescriptor = {
      actorId: actor,
      commandType: "update-profile-display-name",
      commandId: commandId(commandIdValue),
      intentDigest: canonicalIntentDigest({ displayName }),
    };
    await this.deps.atomic.updateCurrentProfile({ actorId: actor, displayName, expectedVersion, occurredAt: this.deps.values.now(), idempotency });
    return this.getCurrentProfile();
  }
}

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

export interface CreateExpenseCommand {
  readonly commandId?: CommandId;
  readonly backdatedConfirmationToken?: string;
  readonly householdId: HouseholdId;
  readonly name: string;
  readonly iconCategory?: ExpenseIconCategory;
  readonly amount: PositivePoisha;
  readonly expenseDate: ExpenseDate;
  readonly splitMethod: SplitMethod;
  readonly percentageEntries?: readonly PercentageSplitEntry[];
  readonly allocations: readonly SplitAllocation[];
  readonly payment: { readonly method: "cash" } | { readonly method: "card"; readonly cardId: CardId };
  readonly receipts?: readonly Readonly<{ originalFilename?: string; content: ReceiptContent; commandId?: CommandId }>[];
}

export interface ExpenseView {
  readonly expense: Omit<Expense, "payment"> & { readonly payment: { readonly method: "cash" } | { readonly method: "card" } };
  readonly percentageSourceStatus: ExpensePercentageSourceStatus;
  readonly permissions: Readonly<{
    canEdit: boolean;
    canEditFinancialFields: boolean;
    canDelete: boolean;
  }>;
  readonly financialEditability: ExpenseFinancialEditability;
  readonly privateCardSnapshot?: ExpenseCardPrivateSnapshot;
  readonly addedAfterSettlement: boolean;
  readonly commentCount?: number;
}

export interface ExpenseCommentView {
  readonly commentId: ExpenseComment["commentId"];
  readonly authorUserId: UserId;
  readonly authorDisplayName: string;
  readonly body: string;
  readonly createdAt: IsoInstant;
}

export type ExpenseFinancialEditReason =
  | "confirmed-settlement"
  | "former-member"
  | "legacy-percentage";

export interface ExpenseFinancialEditability {
  readonly state: "editable" | "locked" | "deleted";
  readonly reasons: readonly ExpenseFinancialEditReason[];
  readonly title?: string;
  readonly description?: string;
  readonly deleteDescription?: string;
}

export interface ExpenseMemberView {
  readonly userId: UserId;
  readonly displayName: string;
  readonly status: MembershipSnapshot["status"];
  readonly role: MembershipSnapshot["role"];
}

export interface ExpenseActivityView {
  readonly action: string;
  readonly actorName: string;
  readonly occurredAt: IsoInstant;
  readonly changedFields: readonly string[];
}

export interface PrivateReceiptView {
  readonly visibility: "private";
  readonly receiptId: ReceiptId;
  readonly originalFilename?: string;
  readonly mimeType: ReceiptMetadata["mimeType"];
  readonly sizeBytes: number;
  readonly createdAt: IsoInstant;
  readonly contentStatus: ReceiptContentStatus;
  readonly canRead: boolean;
  readonly canRemove: boolean;
}

export interface ReceiptAttachmentView {
  readonly visibility: "attachment";
  readonly label: "Receipt attached";
}

export type ReceiptView = PrivateReceiptView | ReceiptAttachmentView;

function projectPrivateReceipt(metadata: ReceiptMetadata, canRemove: boolean): PrivateReceiptView {
  const available = metadata.contentStatus === "available";
  return Object.freeze({
    visibility: "private",
    receiptId: metadata.receiptId,
    ...(metadata.originalFilename ? { originalFilename: metadata.originalFilename } : {}),
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    createdAt: metadata.createdAt,
    contentStatus: metadata.contentStatus,
    canRead: available,
    canRemove: available && canRemove,
  });
}

function financialFingerprint(
  expense: Expense,
  cardAssociationIdentity?: string,
): ExpenseFinancialFingerprint {
  return {
    householdId: expense.householdId,
    amount: expense.amount,
    payerId: expense.payerId,
    splitMethod: expense.splitMethod,
    percentageEntries: expense.percentageEntries,
    allocations: expense.allocations,
    expenseDate: expense.expenseDate,
    payment: expense.payment,
    ...(expense.payment.method === "card"
      ? { cardAssociationIdentity }
      : {}),
    deleted: Boolean(expense.deletedAt),
  };
}

function projectionCardAssociationIdentity(
  expense: Expense,
  snapshot?: ExpenseCardPrivateSnapshot,
): string | undefined {
  if (expense.payment.method === "cash") return undefined;
  return snapshot?.cardId ?? expense.payment.cardReference;
}

function financialEditability(
  expense: Expense,
  memberships: readonly MembershipSnapshot[],
  percentageSourceStatus: ExpensePercentageSourceStatus,
  latestConfirmedAt: IsoInstant | undefined,
  cardAssociationIdentity: string | undefined,
): ExpenseFinancialEditability {
  const fingerprint = financialFingerprint(expense, cardAssociationIdentity);
  const reasons: ExpenseFinancialEditReason[] = [];
  if (isExpenseFinanciallyLocked(expense.createdAt, latestConfirmedAt)) {
    reasons.push("confirmed-settlement");
  }
  if (expenseInvolvesFormerMember(fingerprint, memberships)) {
    reasons.push("former-member");
  }
  if (percentageSourceStatus === "legacy-percentage-input-unavailable") {
    reasons.push("legacy-percentage");
  }

  if (expense.deletedAt) {
    return Object.freeze({
      state: "deleted",
      reasons: Object.freeze(reasons),
    });
  }
  if (reasons.length === 0) {
    return Object.freeze({ state: "editable", reasons: Object.freeze([]) });
  }

  if (reasons.includes("confirmed-settlement")) {
    return Object.freeze({
      state: "locked",
      reasons: Object.freeze(reasons),
      title: "Financial details are locked",
      description:
        "This expense existed before a household settlement was confirmed. Changing its financial details could alter balances that have already been settled.",
      deleteDescription:
        "This expense is part of settled financial history and can no longer be deleted.",
    });
  }
  if (reasons.includes("former-member")) {
    return Object.freeze({
      state: "locked",
      reasons: Object.freeze(reasons),
      title: "Financial details are locked",
      description:
        "This expense includes a former member, so its financial history can no longer be changed.",
    });
  }
  return Object.freeze({
    state: "locked",
    reasons: Object.freeze(reasons),
    title: "Financial details are locked",
    description:
      "The original percentage inputs are unavailable, so the saved financial details cannot be changed.",
  });
}

function assertExpenseParticipantsBelongToHousehold(
  expense: Expense,
  memberships: readonly MembershipSnapshot[],
  requireActive: boolean,
): void {
  const membershipByUserId = new Map(
    memberships
      .filter((membership) => membership.householdId === expense.householdId)
      .map((membership) => [membership.userId, membership]),
  );
  for (const allocation of expense.allocations) {
    const membership = membershipByUserId.get(allocation.participantId);
    if (!membership || (requireActive && membership.status !== "active")) {
      throw new DomainError(
        "INVALID_EXPENSE",
        requireActive
          ? "New expense participants must be active household members."
          : "Expense participants must belong to household history.",
      );
    }
  }
}

export interface EditExpenseCommand {
  readonly commandId?: CommandId;
  readonly backdatedConfirmationToken?: string;
  readonly expenseId: ExpenseId;
  readonly expectedRevision: number;
  readonly name: string;
  readonly iconCategory?: ExpenseIconCategory;
  readonly amount: PositivePoisha;
  readonly expenseDate: ExpenseDate;
  readonly splitMethod: SplitMethod;
  readonly percentageEntries?: readonly PercentageSplitEntry[];
  readonly allocations: readonly SplitAllocation[];
  readonly payment:
    | { readonly kind: "preserve" }
    | { readonly kind: "cash"; readonly confirmedPrivateReferenceDetachment: boolean }
    | { readonly kind: "card"; readonly cardId: CardId };
  readonly newReceipts?: readonly Readonly<{
    originalFilename?: string;
    content: ReceiptContent;
    commandId?: CommandId;
  }>[];
  readonly removedReceiptIds?: readonly ReceiptId[];
  /** Trusted production Receipt sagas use stable per-removal command identities. */
  readonly receiptRemovalCommandIds?: Readonly<Record<string, CommandId>>;
}

export class ExpenseApplicationService {
  constructor(private readonly deps: Dependencies) {}
  currentBusinessDate(): ExpenseDate { return businessDateAt(this.deps.values.now()); }

  async listHouseholdMembers(household: HouseholdId): Promise<readonly ExpenseMemberView[]> {
    const actor = await this.deps.session.getCurrentUserId();
    await requireActiveMembership(this.deps.repositories, household, actor);
    const memberships = await this.deps.repositories.memberships.listByHousehold(household);
    const profiles = await this.deps.repositories.profiles.getByIds(
      memberships.map((membership) => membership.userId),
    );
    const names = new Map(profiles.map((profile) => [profile.userId, profile.displayName]));
    return memberships.map((membership) => Object.freeze({
      userId: membership.userId,
      displayName: names.get(membership.userId) ?? "Unknown member",
      status: membership.status,
      role: membership.role,
    }));
  }

  async listExpenseActivity(id: ExpenseId): Promise<readonly ExpenseActivityView[]> {
    const view = await this.getExpense(id);
    const audits = (await this.deps.repositories.auditEvents.listByHousehold(
      view.expense.householdId,
    )).filter(
      (audit) => audit.aggregateType === "expense" && audit.aggregateId === id,
    );
    const profiles = await this.deps.repositories.profiles.getByIds(
      audits.map((audit) => audit.actorId),
    );
    const names = new Map(profiles.map((profile) => [profile.userId, profile.displayName]));
    return audits.map((audit) => Object.freeze({
        action: audit.action,
        actorName: names.get(audit.actorId) ?? "Unknown member",
        occurredAt: audit.occurredAt,
        changedFields: Object.freeze([...audit.changedFields]),
      }));
  }
  async createExpense(command: CreateExpenseCommand): Promise<ExpenseView> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId = command.commandId ?? commandId(this.deps.values.nextId("command"));
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
        receipts: (command.receipts ?? []).map((item) => ({ filename: item.originalFilename?.trim(), mimeType: item.content.mimeType, sizeBytes: item.content.bytes.byteLength, contentDigest: binaryContentDigest(item.content.bytes) })),
      }),
    };
    const replay = await this.deps.repositories.commandOutcomes.get(idempotency);
    if (replay) {
      assertIdempotentIntent(replay, idempotency);
      return this.getExpense(expenseId(replay.resourceId));
    }
    const now = this.deps.values.now();
    await requireActiveMembership(this.deps.repositories, command.householdId, actor);
    const memberships = await this.deps.repositories.memberships.listByHousehold(command.householdId);
    const id = expenseId(this.deps.values.nextId("expense"));
    let selectedCardId: CardId | undefined;
    if (command.payment.method === "card") {
      const card = await this.deps.repositories.cards.getOwned(command.payment.cardId, actor);
      if (!card || card.archivedAt) throw new ApplicationError("NOT_FOUND", "Selectable card not found.");
      selectedCardId = card.cardId;
    }
    if (command.splitMethod === "percentage" && command.percentageEntries === undefined) {
      throw new DomainError(
        "LEGACY_PERCENTAGE_INPUT_UNAVAILABLE",
        "New percentage expenses require their original basis-point entries.",
      );
    }
    if (command.splitMethod !== "percentage" && command.percentageEntries !== undefined) {
      throw new DomainError(
        "INVALID_EXPENSE",
        "Only percentage expenses may include percentage source entries.",
      );
    }
    assertExpenseDateWithinEntryWindow(command.expenseDate, now);
    const expense: Expense = { expenseId: id, householdId: command.householdId, creatorId: actor, payerId: actor, name: command.name.trim(), iconCategory: expenseIconCategory(command.iconCategory), amount: command.amount, expenseDate: command.expenseDate, splitMethod: command.splitMethod, ...(command.splitMethod === "percentage" ? { percentageEntries: command.percentageEntries } : {}), allocations: command.allocations, payment: command.payment.method === "cash" ? { method: "cash" } : { method: "card", cardReference: expensePrivateReference(id) }, revision: 1, createdAt: now, updatedAt: now };
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
    const settlements = await this.deps.repositories.settlements.listByHousehold(command.householdId);
    const backdatedBoundary = latestConfirmedSettlementBefore(command.householdId, now, settlements);
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
      requireBackdatedConfirmation(this.deps, payload, command.backdatedConfirmationToken);
    }
    await Promise.all((command.receipts ?? []).map((item) => validateReceiptContent(item.content, this.deps.receiptContentDecoder)));
    const receipts = (command.receipts ?? []).map((item) => { const metadata: ReceiptMetadata = { receiptId: receiptId(this.deps.values.nextId("receipt")), householdId: command.householdId, expenseId: id, createdByUserId: actor, mimeType: item.content.mimeType, ...(item.originalFilename ? { originalFilename: item.originalFilename.trim() } : {}), sizeBytes: item.content.bytes.byteLength, createdAt: now, contentStatus: "available" }; assertReceiptMetadata(metadata); return { metadata, content: item.content }; });
    const resourceId = await this.deps.atomic.createExpense({ expense, actorId: actor, commandId: activeCommandId, idempotency, relevantIntentDigest, ...(command.backdatedConfirmationToken ? { backdatedConfirmationToken: command.backdatedConfirmationToken } : {}), ...(selectedCardId ? { selectedCardId } : {}), receipts, auditEvent: event(this.deps.values, command.householdId, actor, "expense", id, "created", ["name", "iconCategory", "amount", "expenseDate", "allocations", "payment", ...(receipts.length ? ["receipts"] : [])], now) });
    return this.getExpense(expenseId(resourceId));
  }

  async getExpense(id: ExpenseId): Promise<ExpenseView> {
    const actor = await this.deps.session.getCurrentUserId();
    const expense = await this.deps.repositories.expenses.getById(id);
    if (!expense) throw new ApplicationError("NOT_FOUND", "Expense not found.");
    const [memberships, settlements, counts] = await Promise.all([
      this.deps.repositories.memberships.listByHousehold(expense.householdId),
      this.deps.repositories.settlements.listByHousehold(expense.householdId),
      this.deps.repositories.expenseComments.countForExpenses(expense.householdId, [id]),
    ]);
    assertCanViewExpense(getExpensePermissions(expense.householdId, actor, expense.creatorId, memberships));
    const snapshot = actor === expense.creatorId && expense.payment.method === "card" ? await this.deps.repositories.expenses.getPrivateCardSnapshot(id, actor) : undefined;
    return this.view(
      expense,
      actor,
      memberships,
      settlements,
      snapshot,
      counts.get(id) ?? 0,
    );
  }

  async listHouseholdExpenses(household: HouseholdId, includeDeleted = false): Promise<readonly ExpenseView[]> {
    const actor = await this.deps.session.getCurrentUserId();
    await requireActiveMembership(this.deps.repositories, household, actor);
    const [history, memberships, settlements] = await Promise.all([
      this.deps.repositories.expenses.listHouseholdHistory(household),
      this.deps.repositories.memberships.listByHousehold(household),
      this.deps.repositories.settlements.listByHousehold(household),
    ]);
    const visible = includeDeleted ? history : history.filter((expense) => !expense.deletedAt);
    const counts = await this.deps.repositories.expenseComments.countForExpenses(household, visible.map((expense) => expense.expenseId));
    return Promise.all(visible.map(async (expense) => this.view(expense, actor, memberships, settlements, actor === expense.creatorId && expense.payment.method === "card" ? await this.deps.repositories.expenses.getPrivateCardSnapshot(expense.expenseId, actor) : undefined, counts.get(expense.expenseId) ?? 0)));
  }

  async listExpenseComments(id: ExpenseId): Promise<readonly ExpenseCommentView[]> {
    const actor = await this.deps.session.getCurrentUserId();
    const expense = await this.deps.repositories.expenses.getById(id);
    if (!expense) throw new ApplicationError("NOT_FOUND", "Expense not found.");
    const household = await this.deps.repositories.households.getById(expense.householdId);
    if (!household || household.deletedAt) throw new ApplicationError("NOT_FOUND", "Expense not found.");
    await requireActiveMembership(this.deps.repositories, expense.householdId, actor);
    const comments = await this.deps.repositories.expenseComments.listForExpense(id);
    const profiles = await this.deps.repositories.profiles.getByIds(comments.map((comment) => comment.authorUserId));
    const names = new Map(profiles.map((profile) => [profile.userId, profile.displayName]));
    return comments.map((comment) => Object.freeze({ commentId: comment.commentId, authorUserId: comment.authorUserId, authorDisplayName: names.get(comment.authorUserId) ?? "Former member", body: comment.body, createdAt: comment.createdAt }));
  }

  async createExpenseComment(id: ExpenseId, bodyInput: string, requestedCommandId: CommandId): Promise<ExpenseCommentView> {
    const actor = await this.deps.session.getCurrentUserId();
    const expense = await this.deps.repositories.expenses.getById(id);
    if (!expense || expense.deletedAt) throw new ApplicationError("NOT_FOUND", "Expense not found.");
    const household = await this.deps.repositories.households.getById(expense.householdId);
    if (!household || household.deletedAt) throw new ApplicationError("NOT_FOUND", "Expense not found.");
    await requireActiveMembership(this.deps.repositories, expense.householdId, actor);
    const body = normalizeExpenseCommentBody(bodyInput);
    const descriptor: IdempotencyDescriptor = { actorId: actor, commandType: "create-expense-comment", commandId: requestedCommandId, intentDigest: canonicalIntentDigest({ expenseId: id, body }) };
    const replay = await this.deps.repositories.commandOutcomes.get(descriptor);
    if (replay) {
      assertIdempotentIntent(replay, descriptor);
      const existing = (await this.deps.repositories.expenseComments.listForExpense(id)).find((comment) => comment.commentId === replay.resourceId);
      if (!existing) throw new ApplicationError("PERSISTENCE_FAILURE", "Stored comment outcome could not be reconstructed.");
      const profile = await this.deps.repositories.profiles.getByIds([existing.authorUserId]);
      return Object.freeze({ commentId: existing.commentId, authorUserId: existing.authorUserId, authorDisplayName: profile[0]?.displayName ?? "Former member", body: existing.body, createdAt: existing.createdAt });
    }
    const comment: ExpenseComment = { commentId: expenseCommentId(this.deps.values.nextId("expense-comment")), householdId: expense.householdId, expenseId: id, authorUserId: actor, body, createdAt: this.deps.values.now() };
    assertExpenseComment(comment);
    await this.deps.atomic.createExpenseComment({ comment, idempotency: descriptor });
    const profile = await this.deps.repositories.profiles.getByIds([actor]);
    return Object.freeze({ commentId: comment.commentId, authorUserId: actor, authorDisplayName: profile[0]?.displayName ?? "Household member", body, createdAt: comment.createdAt });
  }

  async editExpense(command: EditExpenseCommand): Promise<ExpenseView> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId = command.commandId ?? commandId(this.deps.values.nextId("command"));
    const editIntent = Object.fromEntries(Object.entries(command).filter(([key]) => key !== "commandId"));
    const delivery: IdempotencyDescriptor = { actorId: actor, commandType: "edit-expense", commandId: activeCommandId, intentDigest: canonicalIntentDigest(editIntent) };
    const replay = await this.deps.repositories.commandOutcomes.get(delivery);
    if (replay) {
      assertIdempotentIntent(replay, delivery);
      if (replay.resourceId !== command.expenseId) throw new ApplicationError("NOT_FOUND", "Expense not found.");
      return this.getExpense(command.expenseId);
    }
    const original = await this.deps.repositories.expenses.getById(command.expenseId);
    if (!original || original.deletedAt) throw new ApplicationError("NOT_FOUND", "Expense not found.");
    const [memberships, settlements] = await Promise.all([
      this.deps.repositories.memberships.listByHousehold(original.householdId),
      this.deps.repositories.settlements.listByHousehold(original.householdId),
    ]);
    assertCanEditExpense(getExpensePermissions(original.householdId, actor, original.creatorId, memberships));
    if (command.expectedRevision !== original.revision) {
      throw new ApplicationError("EXPENSE_VERSION_CONFLICT", "This expense changed while you were editing it.");
    }
    if (command.splitMethod !== "percentage" && command.percentageEntries !== undefined) {
      throw new DomainError(
        "INVALID_EXPENSE",
        "Only percentage expenses may include percentage source entries.",
      );
    }
    const existingSnapshot = actor === original.creatorId
      ? await this.deps.repositories.expenses.getPrivateCardSnapshot(original.expenseId, actor)
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
    if (command.payment.kind === "preserve") paymentRequest = { kind: "preserve" };
    else if (command.payment.kind === "cash") paymentRequest = { kind: "change-to-cash", confirmedPrivateReferenceDetachment: command.payment.confirmedPrivateReferenceDetachment };
    else {
      const card = await this.deps.repositories.cards.getOwned(command.payment.cardId, actor);
      if (!card || card.archivedAt) throw new ApplicationError("NOT_FOUND", "Selectable card not found.");
      if (original.payment.method === "card" && existingSnapshot?.cardId === card.cardId) {
        paymentRequest = { kind: "preserve" };
      } else {
        selectedCardId = card.cardId;
        paymentRequest = { kind: "select-card", cardReference: expensePrivateReference(original.expenseId) };
      }
    }
    const payment = applyExpensePaymentEdit(original.householdId, actor, original.creatorId, memberships, original.payment, paymentRequest);
    const preserveOpaquePrivateSnapshot = actor !== original.creatorId && payment.method === "card";
    if (payment.method === "card" && !selectedCardId && !existingSnapshot && !preserveOpaquePrivateSnapshot) throw new ApplicationError("CONFLICT", "Card expense history requires a private snapshot.");
    const percentageEntries = command.splitMethod === "percentage"
      ? command.percentageEntries ?? (original.splitMethod === "percentage" ? original.percentageEntries : undefined)
      : undefined;
    if (command.splitMethod === "percentage" && original.splitMethod !== "percentage" && percentageEntries === undefined) {
      throw new DomainError(
        "LEGACY_PERCENTAGE_INPUT_UNAVAILABLE",
        "Changing to a percentage split requires original basis-point entries.",
      );
    }
    const proposed: Expense = { ...original, percentageEntries: undefined, name: command.name.trim(), iconCategory: expenseIconCategory(command.iconCategory ?? original.iconCategory), amount: command.amount, expenseDate: command.expenseDate, splitMethod: command.splitMethod, ...(percentageEntries === undefined ? {} : { percentageEntries }), allocations: command.allocations, payment };
    assertExpense(proposed);
    assertExpenseParticipantsBelongToHousehold(proposed, memberships, false);
    const originalCardAssociationIdentity = original.payment.method === "card"
      ? existingSnapshot?.cardId ?? original.payment.cardReference
      : undefined;
    const proposedCardAssociationIdentity = proposed.payment.method === "card"
      ? selectedCardId ?? originalCardAssociationIdentity
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
    assertFormerMemberChangeAllowed(originalFingerprint, proposedFingerprint, memberships);
    assertLegacyPercentageChangeAllowed(originalFingerprint, proposedFingerprint);
    const financialChanged = !expenseFinancialFingerprintsEqual(originalFingerprint, proposedFingerprint);
    const hasReceiptChanges = Boolean(command.newReceipts?.length || command.removedReceiptIds?.length);
    if (!financialChanged && proposed.name === original.name && proposed.iconCategory === expenseIconCategory(original.iconCategory) && !hasReceiptChanges) {
      return this.view(original, actor, memberships, settlements, existingSnapshot);
    }
    const commandInstant = this.deps.values.now();
    const dateChanged = proposed.expenseDate !== original.expenseDate;
    if (dateChanged) assertExpenseDateWithinEntryWindow(proposed.expenseDate, commandInstant);
    const relevantIntentDigest = expenseRelevantIntentDigest({
      amount: proposed.amount,
      expenseDate: proposed.expenseDate,
      splitMethod: proposed.splitMethod,
      percentageEntries: proposed.percentageEntries,
      allocations: proposed.allocations,
      paymentMethod: proposed.payment.method,
      ...(proposed.payment.method === "card"
        ? { cardAssociationIdentity: actor === original.creatorId ? proposedCardAssociationIdentity : "preserved-private-card" }
        : {}),
    });
    if (financialChanged) {
      const boundary = latestConfirmedSettlementBefore(original.householdId, commandInstant, settlements);
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
        requireBackdatedConfirmation(this.deps, payload, command.backdatedConfirmationToken);
      }
    }
    const updated: Expense = { ...proposed, revision: original.revision + 1, updatedAt: commandInstant };
    const receiptIds = command.removedReceiptIds ?? [];
    if ((receiptIds.length > 0 || (command.newReceipts?.length ?? 0) > 0) && actor !== original.creatorId) {
      throw new ApplicationError("RECEIPT_PRIVATE_ACCESS_FORBIDDEN", "Only the Expense creator may manage Receipts.");
    }
    if (new Set(receiptIds).size !== receiptIds.length) {
      throw new ApplicationError("CONFLICT", "A receipt cannot be removed twice in one edit.");
    }
    const receiptRemovals = await Promise.all(
      receiptIds.map(async (id) => {
        const metadata = await this.deps.repositories.receipts.getMetadata(id);
        if (!metadata || metadata.contentStatus !== "available" || metadata.expenseId !== original.expenseId) {
          throw new ApplicationError("NOT_FOUND", "Receipt not found.");
        }
        return markReceiptContentUserDeleted(metadata, updated.updatedAt, actor);
      }),
    );
    await Promise.all((command.newReceipts ?? []).map((item) => validateReceiptContent(item.content, this.deps.receiptContentDecoder)));
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
      event(this.deps.values, original.householdId, actor, "expense", original.expenseId, "edited", ["expense", ...(receiptAdditions.length || receiptRemovals.length ? ["receipts"] : [])], commandInstant),
      ...receiptAdditions.map((item) => event(this.deps.values, original.householdId, actor, "receipt", item.metadata.receiptId, "created", ["mimeType", "sizeBytes"], commandInstant)),
      ...receiptRemovals.map((item) => event(this.deps.values, original.householdId, actor, "receipt", item.receiptId, "deleted", ["contentStatus", "contentRemovedAt", "contentRemovedByUserId"], commandInstant)),
    ];
    await this.deps.atomic.editExpense({ expectedExpenseId: original.expenseId, expense: updated, actorId: actor, commandId: activeCommandId, relevantIntentDigest, backdatedConfirmationApplicable: true, ...(command.backdatedConfirmationToken ? { backdatedConfirmationToken: command.backdatedConfirmationToken } : {}), expectedRevision: command.expectedRevision, ...(selectedCardId ? { selectedCardId } : {}), receiptAdditions, receiptRemovals, auditEvents });
    const committedSnapshot = actor === original.creatorId && payment.method === "card"
      ? await this.deps.repositories.expenses.getPrivateCardSnapshot(original.expenseId, actor)
      : undefined;
    if (actor === original.creatorId && payment.method === "card" && !committedSnapshot) {
      throw new ApplicationError("PERSISTENCE_FAILURE", "Card expense history could not be read after editing.");
    }
    const committedSettlements = await this.deps.repositories.settlements.listByHousehold(original.householdId);
    return this.view(
      updated,
      actor,
      memberships,
      committedSettlements,
      committedSnapshot,
    );
  }

  async deleteExpense(id: ExpenseId, expectedRevision: number, requestedCommandId?: CommandId): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId = requestedCommandId ?? commandId(this.deps.values.nextId("command"));
    const delivery: IdempotencyDescriptor = { actorId: actor, commandType: "delete-expense", commandId: activeCommandId, intentDigest: canonicalIntentDigest({ expenseId: id, expectedRevision }) };
    const replay = await this.deps.repositories.commandOutcomes.get(delivery);
    if (replay) {
      assertIdempotentIntent(replay, delivery);
      if (replay.resourceId !== id) throw new ApplicationError("NOT_FOUND", "Expense not found.");
      return;
    }
    const original = await this.deps.repositories.expenses.getById(id);
    if (!original || original.deletedAt) throw new ApplicationError("NOT_FOUND", "Expense not found.");
    const [memberships, settlements] = await Promise.all([
      this.deps.repositories.memberships.listByHousehold(original.householdId),
      this.deps.repositories.settlements.listByHousehold(original.householdId),
    ]);
    assertCanDeleteExpense(getExpensePermissions(original.householdId, actor, original.creatorId, memberships));
    if (expectedRevision !== original.revision) {
      throw new ApplicationError("EXPENSE_VERSION_CONFLICT", "This expense changed while you were editing it.");
    }
    const existingSnapshot = actor === original.creatorId && original.payment.method === "card"
      ? await this.deps.repositories.expenses.getPrivateCardSnapshot(original.expenseId, actor)
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
    const cardAssociationIdentity = original.payment.method === "card"
      ? existingSnapshot?.cardId ?? original.payment.cardReference
      : undefined;
    const now = this.deps.values.now();
    const deleted: Expense = { ...original, revision: original.revision + 1, updatedAt: now, deletedAt: now, deletedByUserId: actor };
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
    assertFormerMemberChangeAllowed(originalFingerprint, deletedFingerprint, memberships);
    assertLegacyPercentageChangeAllowed(originalFingerprint, deletedFingerprint);
    const relevantIntentDigest = expenseRelevantIntentDigest({
      amount: deleted.amount,
      expenseDate: deleted.expenseDate,
      splitMethod: deleted.splitMethod,
      percentageEntries: deleted.percentageEntries,
      allocations: deleted.allocations,
      paymentMethod: deleted.payment.method,
      ...(cardAssociationIdentity ? { cardAssociationIdentity } : {}),
    });
    await this.deps.atomic.editExpense({ expectedExpenseId: original.expenseId, expense: deleted, actorId: actor, commandId: activeCommandId, relevantIntentDigest, backdatedConfirmationApplicable: false, expectedRevision, auditEvents: [event(this.deps.values, original.householdId, actor, "expense", id, "deleted", ["deletedAt"], now)] });
  }

  private view(
    expense: Expense,
    viewer: UserId,
    memberships: readonly MembershipSnapshot[],
    settlements: readonly import("@/domain/settlements/settlement-types").SettlementRecord[],
    snapshot?: ExpenseCardPrivateSnapshot,
    commentCount = 0,
  ): ExpenseView {
    const projection = projectExpensePayment(viewer, expense.creatorId, expense.payment);
    const publicPayment = projection.method === "cash" ? { method: "cash" as const } : { method: "card" as const };
    const percentageSourceStatus = expensePercentageSourceStatus(expense.splitMethod, expense.percentageEntries);
    const basePermissions = getExpensePermissions(expense.householdId, viewer, expense.creatorId, memberships);
    const editability = financialEditability(
      expense,
      memberships,
      percentageSourceStatus,
      latestConfirmedSettlementAt(expense.householdId, settlements),
      projectionCardAssociationIdentity(expense, snapshot),
    );
    const isReadOnlyHistory = editability.state === "deleted";
    const historicalBoundary = latestConfirmedSettlementBefore(expense.householdId, expense.createdAt, settlements);
    const addedAfterSettlement = isBackdatedAfterSettlement(expense.expenseDate, historicalBoundary);
    return Object.freeze({ expense: Object.freeze({ ...expense, payment: publicPayment }), percentageSourceStatus, permissions: Object.freeze({ canEdit: basePermissions.canEdit && !isReadOnlyHistory, canEditFinancialFields: basePermissions.canEdit && editability.state === "editable", canDelete: basePermissions.canDelete && editability.state === "editable" }), financialEditability: editability, addedAfterSettlement, commentCount, ...(snapshot && viewer === expense.creatorId && expense.payment.method === "card" ? { privateCardSnapshot: Object.freeze({ ...snapshot }) } : {}) });
  }
}

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

export class CardApplicationService {
  constructor(private readonly deps: Dependencies) {}

  async getMyCards(): Promise<CardPageView> {
    const actor = await this.deps.session.getCurrentUserId();
    const cards = await this.deps.repositories.cards.listOwned(actor);
    return Object.freeze({ cards: Object.freeze(cards.map(projectMyCard)) });
  }

  async listMySelectableCards(): Promise<readonly MyCardSummaryView[]> {
    return (await this.getMyCards()).cards;
  }

  async createMyCard(input: Readonly<{
    name: string;
    type: Card["type"];
    colorId: CardColorId;
    commandId?: CommandId;
  }>): Promise<MyCardSummaryView> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId = input.commandId ?? commandId(this.deps.values.nextId("command"));
    const idempotency: IdempotencyDescriptor = { actorId: actor, commandType: "create-card", commandId: activeCommandId, intentDigest: canonicalIntentDigest({ name: input.name.trim(), type: input.type, colorId: input.colorId }) };
    const replay = await this.deps.repositories.commandOutcomes.get(idempotency);
    if (replay) {
      assertIdempotentIntent(replay, idempotency);
      const replayed = await this.deps.repositories.cards.getOwned(cardId(replay.resourceId), actor);
      if (!replayed) throw new ApplicationError("NOT_FOUND", "Card not found.");
      return projectMyCard(replayed);
    }
    const now = this.deps.values.now();
    const card: Card = {
      cardId: cardId(this.deps.values.nextId("card")),
      ownerId: actor,
      name: input.name.trim(),
      type: input.type,
      colorId: input.colorId,
      createdAt: now,
      updatedAt: now,
    };
    assertCard(card);
    const resourceId = await this.deps.atomic.createCard({ card, idempotency });
    const committed = await this.deps.repositories.cards.getOwned(cardId(resourceId), actor);
    if (!committed) throw new ApplicationError("NOT_FOUND", "Card not found.");
    return projectMyCard(committed);
  }

  async updateMyCard(id: CardId, input: Readonly<{
    name: string;
    type: Card["type"];
    colorId: CardColorId;
    commandId?: CommandId;
  }>): Promise<MyCardSummaryView> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId = input.commandId ?? commandId(this.deps.values.nextId("command"));
    const delivery: IdempotencyDescriptor = { actorId: actor, commandType: "edit-card", commandId: activeCommandId, intentDigest: canonicalIntentDigest({ cardId: id, name: input.name.trim(), type: input.type, colorId: input.colorId }) };
    const replay = await this.deps.repositories.commandOutcomes.get(delivery);
    if (replay) {
      assertIdempotentIntent(replay, delivery);
      const replayed = await this.deps.repositories.cards.getOwned(cardId(replay.resourceId), actor);
      if (!replayed) throw new ApplicationError("NOT_FOUND", "Card not found.");
      return projectMyCard(replayed);
    }
    const current = await this.deps.repositories.cards.getOwned(id, actor);
    if (!current || current.archivedAt) throw new ApplicationError("NOT_FOUND", "Card not found.");
    const updated: Card = {
      ...current,
      name: input.name.trim(),
      type: input.type,
      colorId: input.colorId,
      updatedAt: this.deps.values.now(),
    };
    assertCard(updated);
    await this.deps.atomic.updateCard({ card: updated, expectedUpdatedAt: current.updatedAt });
    return projectMyCard(updated);
  }

  async getMyCardRemovalPreview(id: CardId): Promise<CardRemovalPreview> {
    const actor = await this.deps.session.getCurrentUserId();
    const [card, action] = await Promise.all([
      this.deps.repositories.cards.getOwned(id, actor),
      this.deps.repositories.cards.getOwnedRemovalAction(id, actor),
    ]);
    if (!card || card.archivedAt || !action) throw new ApplicationError("NOT_FOUND", "Card not found.");
    return buildCardRemovalPreview(card, action);
  }

  async deleteOrArchiveMyCard(
    id: CardId,
    expectedAction: CardRemovalAction,
    requestedCommandId?: CommandId,
  ): Promise<CardRemovalResult> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId = requestedCommandId ?? commandId(this.deps.values.nextId("command"));
    const delivery: IdempotencyDescriptor = { actorId: actor, commandType: "remove-card", commandId: activeCommandId, intentDigest: canonicalIntentDigest({ cardId: id, expectedAction }) };
    const replay = await this.deps.repositories.commandOutcomes.get(delivery);
    if (replay) {
      assertIdempotentIntent(replay, delivery);
      const [action, resourceId] = replay.resourceId.split(":", 2);
      if (resourceId !== id || (action !== "delete" && action !== "archive")) throw new ApplicationError("NOT_FOUND", "Card not found.");
      return action === "delete" ? "deleted" : "archived";
    }
    return this.deps.atomic.removeCard({
      cardId: id,
      ownerId: actor,
      expectedAction,
      occurredAt: this.deps.values.now(),
    });
  }
}

export class ReceiptApplicationService {
  constructor(private readonly deps: Dependencies) {}
  async getMyAvailableReceiptBytes(): Promise<number> { const actor = await this.deps.session.getCurrentUserId(); return this.deps.repositories.receipts.availableBytesByUploader(actor); }
  async readReceipt(id: ReceiptId): Promise<ReceiptContent> { const actor = await this.deps.session.getCurrentUserId(); const metadata = await this.deps.repositories.receipts.getMetadata(id); if (!metadata || metadata.contentStatus !== "available") throw new ApplicationError("NOT_FOUND", "Receipt content is not available."); const expense = await this.deps.repositories.expenses.getById(metadata.expenseId); if (!expense || (actor !== expense.creatorId && actor !== metadata.createdByUserId)) throw new ApplicationError("NOT_FOUND", "Receipt content is not available."); await requireActiveMembership(this.deps.repositories, metadata.householdId, actor); const content = await this.deps.repositories.receipts.readContent(id); if (!content) throw new ApplicationError("NOT_FOUND", "Receipt content not found."); return content; }
  async listExpenseReceipts(expenseIdValue: ExpenseId): Promise<readonly ReceiptView[]> { const actor = await this.deps.session.getCurrentUserId(); const expense = await this.deps.repositories.expenses.getById(expenseIdValue); if (!expense) throw new ApplicationError("NOT_FOUND", "Expense not found."); await requireActiveMembership(this.deps.repositories, expense.householdId, actor); const metadata = await this.deps.repositories.receipts.listForExpense(expenseIdValue); if (actor === expense.creatorId) return metadata.map((item) => projectPrivateReceipt(item, true)); const mine = metadata.filter((item) => item.createdByUserId === actor).map((item) => projectPrivateReceipt(item, false)); return metadata.some((item) => item.createdByUserId !== actor) ? Object.freeze([...mine, Object.freeze({ visibility: "attachment" as const, label: "Receipt attached" as const })]) : mine; }
  async addReceipt(expenseIdValue: ExpenseId, input: Readonly<{ originalFilename?: string; content: ReceiptContent; commandId?: CommandId }>): Promise<ReceiptMetadata> { const actor = await this.deps.session.getCurrentUserId(); const activeCommandId = input.commandId ?? commandId(this.deps.values.nextId("command")); const idempotency: IdempotencyDescriptor = { actorId: actor, commandType: "upload-receipt", commandId: activeCommandId, intentDigest: canonicalIntentDigest({ expenseId: expenseIdValue, filename: input.originalFilename?.trim(), mimeType: input.content.mimeType, sizeBytes: input.content.bytes.byteLength, contentDigest: binaryContentDigest(input.content.bytes) }) }; const replay = await this.deps.repositories.commandOutcomes.get(idempotency); if (replay) { assertIdempotentIntent(replay, idempotency); const replayed = await this.deps.repositories.receipts.getMetadata(receiptId(replay.resourceId)); if (!replayed || replayed.createdByUserId !== actor || replayed.expenseId !== expenseIdValue) throw new ApplicationError("NOT_FOUND", "Receipt not found."); await requireActiveMembership(this.deps.repositories, replayed.householdId, actor); return replayed; } const expense = await this.deps.repositories.expenses.getById(expenseIdValue); if (!expense || expense.deletedAt || actor !== expense.creatorId) throw new ApplicationError("NOT_FOUND", "Expense not found."); const memberships = await this.deps.repositories.memberships.listByHousehold(expense.householdId); assertCanEditExpense(getExpensePermissions(expense.householdId, actor, expense.creatorId, memberships)); await validateReceiptContent(input.content, this.deps.receiptContentDecoder); const now = this.deps.values.now(); const metadata: ReceiptMetadata = { receiptId: receiptId(this.deps.values.nextId("receipt")), householdId: expense.householdId, expenseId: expense.expenseId, createdByUserId: actor, mimeType: input.content.mimeType, ...(input.originalFilename ? { originalFilename: input.originalFilename.trim() } : {}), sizeBytes: input.content.bytes.byteLength, createdAt: now, contentStatus: "available" }; assertReceiptMetadata(metadata); const resourceId = await this.deps.atomic.createReceipt({ metadata, content: input.content, idempotency, auditEvent: event(this.deps.values, expense.householdId, actor, "receipt", metadata.receiptId, "created", ["mimeType", "sizeBytes", "contentStatus"], now) }); const committed = await this.deps.repositories.receipts.getMetadata(receiptId(resourceId)); if (!committed || committed.createdByUserId !== actor || committed.expenseId !== expenseIdValue) throw new ApplicationError("NOT_FOUND", "Receipt not found."); return committed; }
  async deleteReceipt(id: ReceiptId): Promise<void> { const actor = await this.deps.session.getCurrentUserId(); const metadata = await this.deps.repositories.receipts.getMetadata(id); if (!metadata || metadata.contentStatus !== "available") throw new ApplicationError("NOT_FOUND", "Receipt content is not available."); const expense = await this.deps.repositories.expenses.getById(metadata.expenseId); if (!expense || actor !== expense.creatorId) throw new ApplicationError("NOT_FOUND", "Receipt content is not available."); const memberships = await this.deps.repositories.memberships.listByHousehold(metadata.householdId); assertCanEditExpense(getExpensePermissions(metadata.householdId, actor, expense.creatorId, memberships)); const now = this.deps.values.now(); const deleted = markReceiptContentUserDeleted(metadata, now, actor); await this.deps.atomic.deleteReceipt({ metadata: deleted, auditEvent: event(this.deps.values, metadata.householdId, actor, "receipt", id, "deleted", ["contentStatus", "contentRemovedAt", "contentRemovedByUserId"], now) }); }
}

export class HouseFinanceApplication {
  readonly analytics: HouseholdAnalyticsApplicationService;
  readonly profiles: ProfileApplicationService;
  readonly households: HouseholdApplicationService;
  readonly expenses: ExpenseApplicationService;
  readonly settlements: SettlementApplicationService;
  readonly cards: CardApplicationService;
  readonly receipts: ReceiptApplicationService;
  constructor(deps: Dependencies) { this.analytics = new HouseholdAnalyticsApplicationService(deps.repositories, deps.session); this.profiles = new ProfileApplicationService(deps); this.households = new HouseholdApplicationService(deps); this.expenses = new ExpenseApplicationService(deps); this.settlements = new SettlementApplicationService(deps); this.cards = new CardApplicationService(deps); this.receipts = new ReceiptApplicationService(deps); }
}
