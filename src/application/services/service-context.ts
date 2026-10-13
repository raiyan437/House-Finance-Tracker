import { ApplicationError } from "../errors/application-error";
import { type BackdatedExpenseConfirmationAuthority } from "../expenses/backdated-expense-confirmation";
import { type ReceiptContentDecoder } from "../receipts/receipt-content-validation";
import type { AtomicApplicationPersistence, ApplicationRepositories, CurrentSession } from "../repositories";
import { calculateHouseholdBalances } from "@/domain/balances/calculate-household-balances";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import { toBalanceExpense, type AuditEvent } from "@/domain/records/domain-records";
import { auditEventId, type HouseholdId, type UserId } from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";


export type GeneratedIdKind = "user" | "household" | "join-request" | "expense" | "expense-comment" | "settlement" | "card" | "receipt" | "audit" | "command";

export interface ApplicationValues {
  now(): IsoInstant;
  nextId(kind: GeneratedIdKind): string;
  nextHouseholdCodeCandidate(): string;
}

export interface Dependencies {
  readonly repositories: ApplicationRepositories;
  readonly atomic: AtomicApplicationPersistence;
  readonly session: CurrentSession;
  readonly values: ApplicationValues;
  readonly receiptContentDecoder?: ReceiptContentDecoder;
  readonly backdatedConfirmationAuthority?: BackdatedExpenseConfirmationAuthority;
}

export function event(values: ApplicationValues, household: HouseholdId, actor: UserId, aggregateType: AuditEvent["aggregateType"], aggregateId: string, action: string, changedFields: readonly string[], occurredAt = values.now()): AuditEvent {
  return Object.freeze({ auditEventId: auditEventId(values.nextId("audit")), householdId: household, actorId: actor, aggregateType, aggregateId, action, occurredAt, changedFields: Object.freeze([...changedFields]) });
}

export async function requireActiveMembership(repositories: ApplicationRepositories, household: HouseholdId, actor: UserId): Promise<MembershipSnapshot> {
  const membership = await repositories.memberships.get(household, actor);
  if (!membership || membership.status !== "active") throw new ApplicationError("NOT_FOUND", "Active household membership not found.");
  return membership;
}

export async function financialContext(repositories: ApplicationRepositories, household: HouseholdId) {
  const [memberships, expenses, settlements] = await Promise.all([
    repositories.memberships.listByHousehold(household),
    repositories.expenses.listHouseholdHistory(household),
    repositories.settlements.listByHousehold(household),
  ]);
  const sheet = calculateHouseholdBalances(household, memberships, expenses.map(toBalanceExpense), settlements);
  return { memberships, expenses, settlements, sheet };
}
