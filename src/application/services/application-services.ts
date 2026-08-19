import { ApplicationError } from "../errors/application-error";
import type {
  AtomicApplicationPersistence,
  CurrentSession,
  ReceiptContent,
} from "../repositories";

export type ExpenseReceiptContent = ReceiptContent;
import { calculateHouseholdBalances } from "@/domain/balances/calculate-household-balances";
import { generateSettlementRecommendations } from "@/domain/balances/settlement-recommendations";
import type { CardColorId } from "@/domain/cards/card-color";
import type { CardRemovalAction, CardRemovalResult } from "@/domain/cards/card-lifecycle";
import { assertFormerMemberChangeAllowed, assertLegacyPercentageChangeAllowed, expenseInvolvesFormerMember, type ExpenseFinancialFingerprint } from "@/domain/expenses/expense-financial-fingerprint";
import { expensePercentageSourceStatus, type ExpensePercentageSourceStatus } from "@/domain/expenses/expense-percentage-source";
import { DomainError } from "@/domain/shared/domain-error";
import { leaveHousehold, removeHouseholdMember, evaluateHouseholdDeletionEligibility, assertEligible } from "@/domain/membership/membership-eligibility";
import { transferLeadership } from "@/domain/membership/leadership-policy";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import { assertCanDeleteExpense, assertCanEditExpense, assertCanViewExpense, getExpensePermissions } from "@/domain/permissions/expense-permissions";
import { applyExpensePaymentEdit, projectExpensePayment, type PaymentEditRequest } from "@/domain/permissions/card-payment-privacy";
import {
  assertCard,
  assertExpense,
  assertHousehold,
  assertJoinRequest,
  assertReceiptMetadata,
  assertUserProfile,
  normalizeEmail,
  toBalanceExpense,
  type AuditEvent,
  type Card,
  type Expense,
  type ExpenseCardPrivateSnapshot,
  type Household,
  type JoinRequest,
  type ReceiptMetadata,
  type UserProfile,
} from "@/domain/records/domain-records";
import { auditEventId, cardId, expenseId, householdId, joinRequestId, receiptId, settlementId, type CardId, type ExpenseId, type HouseholdId, type JoinRequestId, type ReceiptId, type SettlementId, type UserId } from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";
import { createPendingSettlement } from "@/domain/settlements/pending-settlement-policy";
import { cancelSettlement, confirmSettlement, rejectSettlement } from "@/domain/settlements/settlement-lifecycle";
import type { SettlementRecommendation, SettlementStatus } from "@/domain/settlements/settlement-types";
import type { PercentageSplitEntry, SplitAllocation, SplitMethod } from "@/domain/splits/split-types";
import type { ExpenseDate } from "@/domain/dates/expense-date";
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
import type {
  AuditEventRepository,
  CardRepository,
  ExpenseRepository,
  HouseholdRepository,
  JoinRequestRepository,
  MembershipRepository,
  ReceiptRepository,
  SettlementRepository,
  UserProfileRepository,
} from "../repositories";

export type GeneratedIdKind = "user" | "household" | "join-request" | "expense" | "settlement" | "card" | "receipt" | "audit";
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
    }>
  | Readonly<{
      status: "active-leader";
      household: JoinableHouseholdView;
      joinRequests: readonly LeaderJoinRequestView[];
    }>;

export interface ApplicationRepositories {
  readonly profiles: UserProfileRepository;
  readonly households: HouseholdRepository;
  readonly memberships: MembershipRepository;
  readonly joinRequests: JoinRequestRepository;
  readonly expenses: ExpenseRepository;
  readonly settlements: SettlementRepository;
  readonly cards: CardRepository;
  readonly receipts: ReceiptRepository;
  readonly auditEvents: AuditEventRepository;
}

interface Dependencies {
  readonly repositories: ApplicationRepositories;
  readonly atomic: AtomicApplicationPersistence;
  readonly session: CurrentSession;
  readonly values: ApplicationValues;
}

function event(values: ApplicationValues, household: HouseholdId, actor: UserId, aggregateType: AuditEvent["aggregateType"], aggregateId: string, action: string, changedFields: readonly string[]): AuditEvent {
  return Object.freeze({ auditEventId: auditEventId(values.nextId("audit")), householdId: household, actorId: actor, aggregateType, aggregateId, action, occurredAt: values.now(), changedFields: Object.freeze([...changedFields]) });
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
  async updateCurrentProfile(displayName: string, emailInput: string): Promise<UserProfile> { const current = await this.getCurrentProfile(); const email = normalizeEmail(emailInput); const updated: UserProfile = { ...current, displayName: displayName.trim(), ...email, updatedAt: this.deps.values.now() }; assertUserProfile(updated); const conflict = await this.deps.repositories.profiles.findByEmailKey(email.emailKey); if (conflict && conflict.userId !== current.userId) throw new ApplicationError("CONFLICT", "That local email is already in use."); await this.deps.repositories.profiles.update(updated); return updated; }
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
    if (membership.role === "member") {
      return Object.freeze({ status: "active-member", household: householdView });
    }

    const requests = (await this.deps.repositories.joinRequests.listByHousehold(household.householdId))
      .filter((request) => request.status === "pending");
    const profiles = await this.deps.repositories.profiles.getByIds(requests.map((request) => request.userId));
    const names = new Map(profiles.map((profile) => [profile.userId, profile.displayName]));
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

  async renameHousehold(householdIdValue: HouseholdId, name: string): Promise<Household> {
    const actor = await this.deps.session.getCurrentUserId();
    const membership = await requireActiveMembership(this.deps.repositories, householdIdValue, actor);
    if (membership.role !== "leader") throw new ApplicationError("NOT_FOUND", "Household not found.");
    const household = await this.deps.repositories.households.getById(householdIdValue);
    if (!household || household.deletedAt) throw new ApplicationError("NOT_FOUND", "Household not found.");
    const updated: Household = { ...household, name: name.trim(), updatedAt: this.deps.values.now() };
    assertHousehold(updated);
    await this.deps.atomic.updateHousehold({ household: updated, auditEvent: event(this.deps.values, householdIdValue, actor, "household", householdIdValue, "renamed", ["name"]) });
    return updated;
  }

  async listJoinRequests(household: HouseholdId): Promise<readonly JoinRequest[]> {
    const actor = await this.deps.session.getCurrentUserId();
    const membership = await requireActiveMembership(this.deps.repositories, household, actor);
    if (membership.role !== "leader") throw new ApplicationError("NOT_FOUND", "Household join requests not found.");
    return this.deps.repositories.joinRequests.listByHousehold(household);
  }

  async createHousehold(name: string, code: string): Promise<Household> {
    const actor = await this.deps.session.getCurrentUserId();
    const trimmedName = name.trim();
    this.assertHouseholdCode(code);
    if (await this.deps.repositories.memberships.findActiveByUser(actor)) throw new ApplicationError("CONFLICT", "The current user already belongs to a household.");
    if (await this.deps.repositories.joinRequests.findPendingByUser(actor)) throw new ApplicationError("CONFLICT", "Cancel the current Pending join request first.");
    if (await this.deps.repositories.households.findByCode(code)) throw new ApplicationError("CONFLICT", "Household code is already in use.");
    const now = this.deps.values.now();
    const household: Household = { householdId: householdId(this.deps.values.nextId("household")), name: trimmedName, code, createdAt: now, updatedAt: now };
    assertHousehold(household);
    const leaderMembership: MembershipSnapshot = { householdId: household.householdId, userId: actor, status: "active", role: "leader" };
    await this.deps.atomic.createHousehold({ household, leaderMembership, auditEvent: event(this.deps.values, household.householdId, actor, "household", household.householdId, "created", ["name", "code"]) });
    return household;
  }

  async requestToJoin(household: HouseholdId): Promise<JoinRequest> {
    const actor = await this.deps.session.getCurrentUserId();
    const target = await this.deps.repositories.households.getById(household);
    if (!target || target.deletedAt) throw new ApplicationError("NOT_FOUND", "Household not found.");
    if (await this.deps.repositories.memberships.findActiveByUser(actor)) throw new ApplicationError("CONFLICT", "The current user already belongs to a household.");
    if (await this.deps.repositories.joinRequests.findPendingByUser(actor)) throw new ApplicationError("CONFLICT", "The current user already has a Pending join request.");
    const request: JoinRequest = { joinRequestId: joinRequestId(this.deps.values.nextId("join-request")), householdId: household, userId: actor, status: "pending", createdAt: this.deps.values.now() };
    assertJoinRequest(request);
    await this.deps.atomic.createJoinRequest({ request, auditEvent: event(this.deps.values, household, actor, "join-request", request.joinRequestId, "requested", ["status"]) });
    return request;
  }

  private assertHouseholdCode(code: string): void {
    if (!/^[0-9]{9}$/.test(code)) {
      throw new ApplicationError("CONFLICT", "A household code must contain exactly nine digits.");
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
    if (!request || request.status !== "pending") throw new ApplicationError("NOT_FOUND", "Pending join request not found.");
    const membership = await requireActiveMembership(this.deps.repositories, request.householdId, actor);
    if (membership.role !== "leader") throw new ApplicationError("NOT_FOUND", "Pending join request not found.");
    if (await this.deps.repositories.memberships.findActiveByUser(request.userId)) throw new ApplicationError("CONFLICT", "Requester already belongs to a household.");
    const accepted: JoinRequest = { ...request, status: "accepted", resolvedAt: this.deps.values.now(), resolvedByUserId: actor };
    const added: MembershipSnapshot = { householdId: request.householdId, userId: request.userId, status: "active", role: "member" };
    await this.deps.atomic.acceptJoinRequest({ request: accepted, membership: added, auditEvent: event(this.deps.values, request.householdId, actor, "join-request", request.joinRequestId, "accepted", ["status", "membership"]) });
  }

  async rejectJoinRequest(id: JoinRequestId): Promise<void> { await this.resolveJoinRequest(id, "rejected"); }
  async cancelJoinRequest(id: JoinRequestId): Promise<void> { await this.resolveJoinRequest(id, "cancelled"); }

  private async resolveJoinRequest(id: JoinRequestId, status: "rejected" | "cancelled"): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const request = await this.deps.repositories.joinRequests.getById(id);
    if (!request || request.status !== "pending") throw new ApplicationError("NOT_FOUND", "Pending join request not found.");
    if (status === "cancelled") { if (request.userId !== actor) throw new ApplicationError("NOT_FOUND", "Pending join request not found."); }
    else { const membership = await requireActiveMembership(this.deps.repositories, request.householdId, actor); if (membership.role !== "leader") throw new ApplicationError("NOT_FOUND", "Pending join request not found."); }
    const resolved: JoinRequest = { ...request, status, resolvedAt: this.deps.values.now(), resolvedByUserId: actor };
    await this.deps.atomic.transitionJoinRequest({ request: resolved, auditEvent: event(this.deps.values, request.householdId, actor, "join-request", request.joinRequestId, status, ["status"]) });
  }

  async transferLeadership(household: HouseholdId, targetId: UserId): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const memberships = await this.deps.repositories.memberships.listByHousehold(household);
    const result = transferLeadership(household, actor, targetId, memberships);
    const formerLeader = result.find((item) => item.userId === actor)!;
    const newLeader = result.find((item) => item.userId === targetId)!;
    await this.deps.atomic.transferLeadership({ formerLeader, newLeader, auditEvent: event(this.deps.values, household, actor, "membership", targetId, "leadership-transferred", ["role"]) });
  }

  async leaveHousehold(household: HouseholdId): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const context = await financialContext(this.deps.repositories, household);
    const result = leaveHousehold(household, actor, context.memberships, context.sheet, context.settlements);
    const ended = result.find((item) => item.userId === actor)!;
    await this.deps.atomic.endMembership({ membership: ended, auditEvent: event(this.deps.values, household, actor, "membership", actor, "left", ["status"]) });
  }

  async removeMember(household: HouseholdId, targetId: UserId): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const context = await financialContext(this.deps.repositories, household);
    const result = removeHouseholdMember(household, actor, targetId, context.memberships, context.sheet, context.settlements);
    const ended = result.find((item) => item.userId === targetId)!;
    await this.deps.atomic.endMembership({ membership: ended, auditEvent: event(this.deps.values, household, actor, "membership", targetId, "removed", ["status"]) });
  }

  async deleteHousehold(householdIdValue: HouseholdId): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const [household, context] = await Promise.all([this.deps.repositories.households.getById(householdIdValue), financialContext(this.deps.repositories, householdIdValue)]);
    if (!household || household.deletedAt) throw new ApplicationError("NOT_FOUND", "Household not found.");
    assertEligible(evaluateHouseholdDeletionEligibility(householdIdValue, actor, context.memberships, context.sheet, context.settlements));
    const deletedAt = this.deps.values.now();
    const deleted: Household = { ...household, updatedAt: deletedAt, deletedAt, deletedByUserId: actor };
    const formerMemberships = context.memberships.map((membership) => ({ ...membership, status: "former" as const }));
    await this.deps.atomic.deleteHousehold({ household: deleted, formerMemberships, auditEvent: event(this.deps.values, householdIdValue, actor, "household", householdIdValue, "deleted", ["deletedAt", "memberships"]) });
  }
}

export interface CreateExpenseCommand {
  readonly householdId: HouseholdId;
  readonly name: string;
  readonly amount: PositivePoisha;
  readonly expenseDate: ExpenseDate;
  readonly splitMethod: SplitMethod;
  readonly percentageEntries?: readonly PercentageSplitEntry[];
  readonly allocations: readonly SplitAllocation[];
  readonly payment: { readonly method: "cash" } | { readonly method: "card"; readonly cardId: CardId };
  readonly receipts?: readonly Readonly<{ originalFilename?: string; content: ReceiptContent }>[];
}

export interface ExpenseView {
  readonly expense: Omit<Expense, "payment"> & { readonly payment: { readonly method: "cash" } | { readonly method: "card" } };
  readonly percentageSourceStatus: ExpensePercentageSourceStatus;
  readonly permissions: Readonly<{ canEdit: boolean; canDelete: boolean }>;
  readonly financialEditState:
    | "editable"
    | "former-member-frozen"
    | "legacy-percentage-input-unavailable"
    | "deleted";
  readonly privateCardSnapshot?: ExpenseCardPrivateSnapshot;
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

function financialFingerprint(expense: Expense): ExpenseFinancialFingerprint {
  return {
    householdId: expense.householdId,
    amount: expense.amount,
    payerId: expense.payerId,
    splitMethod: expense.splitMethod,
    percentageEntries: expense.percentageEntries,
    allocations: expense.allocations,
    expenseDate: expense.expenseDate,
    payment: expense.payment,
    deleted: Boolean(expense.deletedAt),
  };
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
  readonly expenseId: ExpenseId;
  readonly name: string;
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
  }>[];
  readonly removedReceiptIds?: readonly ReceiptId[];
}

export class ExpenseApplicationService {
  constructor(private readonly deps: Dependencies) {}

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
    await requireActiveMembership(this.deps.repositories, command.householdId, actor);
    const memberships = await this.deps.repositories.memberships.listByHousehold(command.householdId);
    const id = expenseId(this.deps.values.nextId("expense"));
    const now = this.deps.values.now();
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
    const expense: Expense = { expenseId: id, householdId: command.householdId, creatorId: actor, payerId: actor, name: command.name.trim(), amount: command.amount, expenseDate: command.expenseDate, splitMethod: command.splitMethod, ...(command.splitMethod === "percentage" ? { percentageEntries: command.percentageEntries } : {}), allocations: command.allocations, payment: command.payment.method === "cash" ? { method: "cash" } : { method: "card", cardReference: expensePrivateReference(id) }, createdAt: now, updatedAt: now };
    assertExpense(expense);
    assertExpenseParticipantsBelongToHousehold(expense, memberships, true);
    const receipts = (command.receipts ?? []).map((item) => { const metadata: ReceiptMetadata = { receiptId: receiptId(this.deps.values.nextId("receipt")), householdId: command.householdId, expenseId: id, createdByUserId: actor, mimeType: item.content.mimeType, ...(item.originalFilename ? { originalFilename: item.originalFilename.trim() } : {}), sizeBytes: item.content.bytes.byteLength, createdAt: now }; assertReceiptMetadata(metadata); return { metadata, content: item.content }; });
    await this.deps.atomic.createExpense({ expense, ...(selectedCardId ? { selectedCardId } : {}), receipts, auditEvent: event(this.deps.values, command.householdId, actor, "expense", id, "created", ["name", "amount", "expenseDate", "allocations", "payment", ...(receipts.length ? ["receipts"] : [])]) });
    const snapshot = selectedCardId
      ? await this.deps.repositories.expenses.getPrivateCardSnapshot(id, actor)
      : undefined;
    if (selectedCardId && !snapshot) throw new ApplicationError("PERSISTENCE_FAILURE", "Card expense history could not be read after creation.");
    return this.view(expense, actor, memberships, snapshot);
  }

  async getExpense(id: ExpenseId): Promise<ExpenseView> {
    const actor = await this.deps.session.getCurrentUserId();
    const expense = await this.deps.repositories.expenses.getById(id);
    if (!expense) throw new ApplicationError("NOT_FOUND", "Expense not found.");
    const memberships = await this.deps.repositories.memberships.listByHousehold(expense.householdId);
    assertCanViewExpense(getExpensePermissions(expense.householdId, actor, expense.creatorId, memberships));
    const snapshot = actor === expense.creatorId && expense.payment.method === "card" ? await this.deps.repositories.expenses.getPrivateCardSnapshot(id, actor) : undefined;
    return this.view(expense, actor, memberships, snapshot);
  }

  async listHouseholdExpenses(household: HouseholdId, includeDeleted = false): Promise<readonly ExpenseView[]> {
    const actor = await this.deps.session.getCurrentUserId();
    await requireActiveMembership(this.deps.repositories, household, actor);
    const history = await this.deps.repositories.expenses.listHouseholdHistory(household);
    const memberships = await this.deps.repositories.memberships.listByHousehold(household);
    const visible = includeDeleted ? history : history.filter((expense) => !expense.deletedAt);
    return Promise.all(visible.map(async (expense) => this.view(expense, actor, memberships, actor === expense.creatorId && expense.payment.method === "card" ? await this.deps.repositories.expenses.getPrivateCardSnapshot(expense.expenseId, actor) : undefined)));
  }

  async editExpense(command: EditExpenseCommand): Promise<ExpenseView> {
    const actor = await this.deps.session.getCurrentUserId();
    const original = await this.deps.repositories.expenses.getById(command.expenseId);
    if (!original || original.deletedAt) throw new ApplicationError("NOT_FOUND", "Expense not found.");
    const memberships = await this.deps.repositories.memberships.listByHousehold(original.householdId);
    assertCanEditExpense(getExpensePermissions(original.householdId, actor, original.creatorId, memberships));
    if (command.splitMethod !== "percentage" && command.percentageEntries !== undefined) {
      throw new DomainError(
        "INVALID_EXPENSE",
        "Only percentage expenses may include percentage source entries.",
      );
    }
    const existingSnapshot = actor === original.creatorId
      ? await this.deps.repositories.expenses.getPrivateCardSnapshot(original.expenseId, actor)
      : undefined;
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
    const proposed: Expense = { ...original, percentageEntries: undefined, name: command.name.trim(), amount: command.amount, expenseDate: command.expenseDate, splitMethod: command.splitMethod, ...(percentageEntries === undefined ? {} : { percentageEntries }), allocations: command.allocations, payment };
    assertExpense(proposed);
    assertExpenseParticipantsBelongToHousehold(proposed, memberships, false);
    const originalFingerprint = financialFingerprint(original);
    const proposedFingerprint = financialFingerprint(proposed);
    assertLegacyPercentageChangeAllowed(originalFingerprint, proposedFingerprint);
    assertFormerMemberChangeAllowed(originalFingerprint, proposedFingerprint, memberships);
    const updated = { ...proposed, updatedAt: this.deps.values.now() };
    const receiptIds = command.removedReceiptIds ?? [];
    if (new Set(receiptIds).size !== receiptIds.length) {
      throw new ApplicationError("CONFLICT", "A receipt cannot be removed twice in one edit.");
    }
    const receiptRemovals = await Promise.all(
      receiptIds.map(async (id) => {
        const metadata = await this.deps.repositories.receipts.getMetadata(id);
        if (!metadata || metadata.deletedAt || metadata.expenseId !== original.expenseId) {
          throw new ApplicationError("NOT_FOUND", "Receipt not found.");
        }
        return {
          ...metadata,
          deletedAt: updated.updatedAt,
          deletedByUserId: actor,
        };
      }),
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
      };
      assertReceiptMetadata(metadata);
      return { metadata, content: item.content };
    });
    const auditEvents = [
      event(this.deps.values, original.householdId, actor, "expense", original.expenseId, "edited", ["expense", ...(receiptAdditions.length || receiptRemovals.length ? ["receipts"] : [])]),
      ...receiptAdditions.map((item) => event(this.deps.values, original.householdId, actor, "receipt", item.metadata.receiptId, "created", ["mimeType", "sizeBytes"])),
      ...receiptRemovals.map((item) => event(this.deps.values, original.householdId, actor, "receipt", item.receiptId, "deleted", ["deletedAt"])),
    ];
    await this.deps.atomic.editExpense({ expense: updated, expectedUpdatedAt: original.updatedAt, ...(selectedCardId ? { selectedCardId } : {}), receiptAdditions, receiptRemovals, auditEvents });
    const committedSnapshot = actor === original.creatorId && payment.method === "card"
      ? await this.deps.repositories.expenses.getPrivateCardSnapshot(original.expenseId, actor)
      : undefined;
    if (actor === original.creatorId && payment.method === "card" && !committedSnapshot) {
      throw new ApplicationError("PERSISTENCE_FAILURE", "Card expense history could not be read after editing.");
    }
    return this.view(updated, actor, memberships, committedSnapshot);
  }

  async deleteExpense(id: ExpenseId): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
    const original = await this.deps.repositories.expenses.getById(id);
    if (!original || original.deletedAt) throw new ApplicationError("NOT_FOUND", "Expense not found.");
    const memberships = await this.deps.repositories.memberships.listByHousehold(original.householdId);
    assertCanDeleteExpense(getExpensePermissions(original.householdId, actor, original.creatorId, memberships));
    const now = this.deps.values.now();
    const deleted: Expense = { ...original, updatedAt: now, deletedAt: now, deletedByUserId: actor };
    assertLegacyPercentageChangeAllowed(financialFingerprint(original), financialFingerprint(deleted));
    assertFormerMemberChangeAllowed(financialFingerprint(original), financialFingerprint(deleted), memberships);
    await this.deps.atomic.editExpense({ expense: deleted, expectedUpdatedAt: original.updatedAt, auditEvents: [event(this.deps.values, original.householdId, actor, "expense", id, "deleted", ["deletedAt"])] });
  }

  private view(expense: Expense, viewer: UserId, memberships: readonly MembershipSnapshot[], snapshot?: ExpenseCardPrivateSnapshot): ExpenseView {
    const projection = projectExpensePayment(viewer, expense.creatorId, expense.payment);
    const publicPayment = projection.method === "cash" ? { method: "cash" as const } : { method: "card" as const };
    const percentageSourceStatus = expensePercentageSourceStatus(expense.splitMethod, expense.percentageEntries);
    const basePermissions = getExpensePermissions(expense.householdId, viewer, expense.creatorId, memberships);
    const formerMemberFrozen = expenseInvolvesFormerMember(financialFingerprint(expense), memberships);
    const financialEditState = expense.deletedAt
      ? "deleted"
      : formerMemberFrozen
        ? "former-member-frozen"
        : percentageSourceStatus === "legacy-percentage-input-unavailable"
          ? "legacy-percentage-input-unavailable"
          : "editable";
    const isReadOnlyHistory = financialEditState === "deleted";
    return Object.freeze({ expense: Object.freeze({ ...expense, payment: publicPayment }), percentageSourceStatus, permissions: Object.freeze({ canEdit: basePermissions.canEdit && !isReadOnlyHistory, canDelete: basePermissions.canDelete && financialEditState === "editable" }), financialEditState, ...(snapshot && viewer === expense.creatorId && expense.payment.method === "card" ? { privateCardSnapshot: Object.freeze({ ...snapshot }) } : {}) });
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

  async createSettlement(requested: SettlementRecommendation): Promise<SettlementId> {
    const actor = await this.deps.session.getCurrentUserId();
    const context = await financialContext(this.deps.repositories, requested.householdId);
    const created = createPendingSettlement({
      settlementId: settlementId(this.deps.values.nextId("settlement")),
      householdId: requested.householdId,
      actorId: actor,
      requestedRecommendation: requested,
      createdAt: this.deps.values.now(),
      memberships: context.memberships,
      currentRecommendations: generateSettlementRecommendations(context.sheet),
      existingSettlements: context.settlements,
    });
    await this.deps.atomic.createSettlement({
      settlement: created,
      auditEvent: event(
        this.deps.values,
        requested.householdId,
        actor,
        "settlement",
        created.settlementId,
        "created-pending",
        ["status", "amount"],
      ),
    });
    return created.settlementId;
  }

  async transitionSettlement(
    id: SettlementId,
    status: Exclude<SettlementStatus, "pending">,
  ): Promise<void> {
    const actor = await this.deps.session.getCurrentUserId();
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
  }>): Promise<MyCardSummaryView> {
    const actor = await this.deps.session.getCurrentUserId();
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
    await this.deps.atomic.createCard({ card });
    return projectMyCard(card);
  }

  async updateMyCard(id: CardId, input: Readonly<{
    name: string;
    type: Card["type"];
    colorId: CardColorId;
  }>): Promise<MyCardSummaryView> {
    const actor = await this.deps.session.getCurrentUserId();
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
  ): Promise<CardRemovalResult> {
    const actor = await this.deps.session.getCurrentUserId();
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
  async readReceipt(id: ReceiptId): Promise<ReceiptContent> { const actor = await this.deps.session.getCurrentUserId(); const metadata = await this.deps.repositories.receipts.getMetadata(id); if (!metadata || metadata.deletedAt) throw new ApplicationError("NOT_FOUND", "Receipt not found."); await requireActiveMembership(this.deps.repositories, metadata.householdId, actor); const content = await this.deps.repositories.receipts.readContent(id); if (!content) throw new ApplicationError("NOT_FOUND", "Receipt content not found."); return content; }
  async listExpenseReceipts(expenseIdValue: ExpenseId): Promise<readonly ReceiptMetadata[]> { const actor = await this.deps.session.getCurrentUserId(); const expense = await this.deps.repositories.expenses.getById(expenseIdValue); if (!expense) throw new ApplicationError("NOT_FOUND", "Expense not found."); await requireActiveMembership(this.deps.repositories, expense.householdId, actor); return (await this.deps.repositories.receipts.listForExpense(expenseIdValue)).filter((metadata) => !metadata.deletedAt); }
  async addReceipt(expenseIdValue: ExpenseId, input: Readonly<{ originalFilename?: string; content: ReceiptContent }>): Promise<ReceiptMetadata> { const actor = await this.deps.session.getCurrentUserId(); const expense = await this.deps.repositories.expenses.getById(expenseIdValue); if (!expense || expense.deletedAt) throw new ApplicationError("NOT_FOUND", "Expense not found."); const memberships = await this.deps.repositories.memberships.listByHousehold(expense.householdId); assertCanEditExpense(getExpensePermissions(expense.householdId, actor, expense.creatorId, memberships)); const metadata: ReceiptMetadata = { receiptId: receiptId(this.deps.values.nextId("receipt")), householdId: expense.householdId, expenseId: expense.expenseId, createdByUserId: actor, mimeType: input.content.mimeType, ...(input.originalFilename ? { originalFilename: input.originalFilename.trim() } : {}), sizeBytes: input.content.bytes.byteLength, createdAt: this.deps.values.now() }; assertReceiptMetadata(metadata); await this.deps.atomic.createReceipt({ metadata, content: input.content, auditEvent: event(this.deps.values, expense.householdId, actor, "receipt", metadata.receiptId, "created", ["mimeType", "sizeBytes"]) }); return metadata; }
  async deleteReceipt(id: ReceiptId): Promise<void> { const actor = await this.deps.session.getCurrentUserId(); const metadata = await this.deps.repositories.receipts.getMetadata(id); if (!metadata || metadata.deletedAt) throw new ApplicationError("NOT_FOUND", "Receipt not found."); const expense = await this.deps.repositories.expenses.getById(metadata.expenseId); if (!expense) throw new ApplicationError("NOT_FOUND", "Expense not found."); const memberships = await this.deps.repositories.memberships.listByHousehold(metadata.householdId); assertCanEditExpense(getExpensePermissions(metadata.householdId, actor, expense.creatorId, memberships)); const deleted = { ...metadata, deletedAt: this.deps.values.now(), deletedByUserId: actor }; await this.deps.atomic.deleteReceipt({ metadata: deleted, auditEvent: event(this.deps.values, metadata.householdId, actor, "receipt", id, "deleted", ["deletedAt"]) }); }
}

export class HouseFinanceApplication {
  readonly profiles: ProfileApplicationService;
  readonly households: HouseholdApplicationService;
  readonly expenses: ExpenseApplicationService;
  readonly settlements: SettlementApplicationService;
  readonly cards: CardApplicationService;
  readonly receipts: ReceiptApplicationService;
  constructor(deps: Dependencies) { this.profiles = new ProfileApplicationService(deps); this.households = new HouseholdApplicationService(deps); this.expenses = new ExpenseApplicationService(deps); this.settlements = new SettlementApplicationService(deps); this.cards = new CardApplicationService(deps); this.receipts = new ReceiptApplicationService(deps); }
}
