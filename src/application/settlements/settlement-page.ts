import { ApplicationError } from "@/application/errors/application-error";
import type { HouseholdBalanceSheet } from "@/domain/balances/balance-types";
import type { MembershipSnapshot } from "@/domain/membership/membership-types";
import { poisha, type Poisha, type PositivePoisha } from "@/domain/money/poisha";
import type { MemberIdentityView } from "@/domain/records/domain-records";
import {
  hasPendingSettlementForPair,
} from "@/domain/settlements/pending-settlement-policy";
import { assessSettlementStaleness } from "@/domain/settlements/settlement-staleness";
import type {
  SettlementRecommendation,
  SettlementRecord,
  SettlementStatus,
} from "@/domain/settlements/settlement-types";
import type {
  HouseholdId,
  SettlementId,
  UserId,
} from "@/domain/shared/identifiers";
import type { IsoInstant } from "@/domain/shared/instant";

export interface SettlementMemberView {
  readonly userId: UserId;
  readonly displayName: string;
  readonly former: boolean;
}

export interface SettlementRecommendationView {
  readonly recommendation: SettlementRecommendation;
  readonly direction: "outgoing" | "incoming";
  readonly counterparty: SettlementMemberView;
  readonly canMarkPaid: boolean;
  readonly blockedReason?: string;
}

export interface SettlementWarningView {
  readonly heading: string;
  readonly detail: string;
}

export interface PendingSettlementView {
  readonly settlementId: SettlementId;
  readonly amount: PositivePoisha;
  readonly createdAt: IsoInstant;
  readonly sender: SettlementMemberView;
  readonly receiver: SettlementMemberView;
  readonly relationship: "sender" | "receiver";
  readonly allowedActions: Readonly<{
    confirm: boolean;
    reject: boolean;
    cancel: boolean;
  }>;
  readonly warning?: SettlementWarningView;
}

export interface SettlementHistoryView {
  readonly settlementId: SettlementId;
  readonly amount: PositivePoisha;
  readonly status: Exclude<SettlementStatus, "pending">;
  readonly createdAt: IsoInstant;
  readonly resolvedAt: IsoInstant;
  readonly sender: SettlementMemberView;
  readonly receiver: SettlementMemberView;
}

export interface SettlementPageView {
  readonly householdId: HouseholdId;
  readonly currentUserId: UserId;
  readonly summary: Readonly<{
    youOwe: Poisha;
    youAreOwed: Poisha;
    settled: boolean;
  }>;
  readonly recommendations: readonly SettlementRecommendationView[];
  readonly pending: readonly PendingSettlementView[];
  readonly history: readonly SettlementHistoryView[];
  readonly actionablePendingCount: number;
}

interface ProjectionInput {
  readonly householdId: HouseholdId;
  readonly actorId: UserId;
  readonly sheet: HouseholdBalanceSheet;
  readonly recommendations: readonly SettlementRecommendation[];
  readonly settlements: readonly SettlementRecord[];
  readonly memberships: readonly MembershipSnapshot[];
  readonly profiles: readonly MemberIdentityView[];
}

function warningFor(
  settlement: SettlementRecord,
  recommendations: readonly SettlementRecommendation[],
): SettlementWarningView | undefined {
  const state = assessSettlementStaleness(settlement, recommendations);
  if (state === "current") return undefined;
  if (state === "amount-changed") {
    return Object.freeze({
      heading: "Your household balance has changed",
      detail: "Confirming will still record the original payment amount.",
    });
  }
  if (state === "direction-reversed") {
    return Object.freeze({
      heading: "Your household balance now points in the other direction",
      detail: "Confirming will still record the original payment and may create a new amount to settle.",
    });
  }
  return Object.freeze({
    heading: "This payment is no longer in the current settlement plan",
    detail: "Confirming will still record the original payment amount.",
  });
}

function compareHistory(left: SettlementHistoryView, right: SettlementHistoryView): number {
  const resolved = right.resolvedAt.localeCompare(left.resolvedAt);
  if (resolved !== 0) return resolved;
  const created = right.createdAt.localeCompare(left.createdAt);
  if (created !== 0) return created;
  return left.settlementId.localeCompare(right.settlementId);
}

export function buildSettlementPageView(input: ProjectionInput): SettlementPageView {
  const membershipById = new Map(input.memberships.map((item) => [item.userId, item]));
  const profileById = new Map(input.profiles.map((item) => [item.userId, item]));
  const member = (id: UserId): SettlementMemberView => {
    const membership = membershipById.get(id);
    const profile = profileById.get(id);
    if (!membership || !profile) {
      throw new ApplicationError("NOT_FOUND", "Household member profile not found.");
    }
    return Object.freeze({
      userId: id,
      displayName: profile.displayName,
      former: membership.status === "former",
    });
  };

  const currentBalance = input.sheet.balances.find(
    (item) => item.memberId === input.actorId,
  );
  if (!currentBalance) {
    throw new ApplicationError("NOT_FOUND", "Current household balance not found.");
  }

  const recommendations = input.recommendations
    .filter(
      (item) => item.senderId === input.actorId || item.receiverId === input.actorId,
    )
    .map((recommendation): SettlementRecommendationView => {
      const direction = recommendation.senderId === input.actorId ? "outgoing" : "incoming";
      const duplicate = hasPendingSettlementForPair(
        input.householdId,
        recommendation.senderId,
        recommendation.receiverId,
        input.settlements,
      );
      return Object.freeze({
        recommendation,
        direction,
        counterparty: member(
          direction === "outgoing" ? recommendation.receiverId : recommendation.senderId,
        ),
        canMarkPaid: direction === "outgoing" && !duplicate,
        ...(direction === "outgoing" && duplicate
          ? { blockedReason: "Resolve the existing Pending payment between you first." }
          : {}),
      });
    });

  const pending = input.settlements
    .filter(
      (item) =>
        item.status === "pending" &&
        (item.senderId === input.actorId || item.receiverId === input.actorId),
    )
    .sort((left, right) => {
      const created = right.createdAt.localeCompare(left.createdAt);
      return created !== 0 ? created : left.settlementId.localeCompare(right.settlementId);
    })
    .map((settlement): PendingSettlementView => {
      const relationship = settlement.senderId === input.actorId ? "sender" : "receiver";
      const warning = warningFor(settlement, input.recommendations);
      return Object.freeze({
        settlementId: settlement.settlementId,
        amount: settlement.amount,
        createdAt: settlement.createdAt,
        sender: member(settlement.senderId),
        receiver: member(settlement.receiverId),
        relationship,
        allowedActions: Object.freeze({
          confirm: relationship === "receiver",
          reject: relationship === "receiver",
          cancel: relationship === "sender",
        }),
        ...(warning ? { warning } : {}),
      });
    });

  const history = input.settlements
    .filter((item): item is SettlementRecord & {
      status: Exclude<SettlementStatus, "pending">;
      resolvedAt: IsoInstant;
    } => item.status !== "pending" && item.resolvedAt !== undefined)
    .map((settlement): SettlementHistoryView => Object.freeze({
      settlementId: settlement.settlementId,
      amount: settlement.amount,
      status: settlement.status,
      createdAt: settlement.createdAt,
      resolvedAt: settlement.resolvedAt,
      sender: member(settlement.senderId),
      receiver: member(settlement.receiverId),
    }))
    .sort(compareHistory);

  return Object.freeze({
    householdId: input.householdId,
    currentUserId: input.actorId,
    summary: Object.freeze({
      youOwe: currentBalance.balance < 0 ? poisha(-currentBalance.balance) : poisha(0),
      youAreOwed: currentBalance.balance > 0 ? currentBalance.balance : poisha(0),
      settled: currentBalance.balance === 0,
    }),
    recommendations: Object.freeze(recommendations),
    pending: Object.freeze(pending),
    history: Object.freeze(history),
    actionablePendingCount: pending.filter((item) => item.relationship === "receiver").length,
  });
}

export function buildPendingSettlementActionPreview(
  view: SettlementPageView,
  settlementId: SettlementId,
): PendingSettlementView {
  const pending = view.pending.find((item) => item.settlementId === settlementId);
  if (!pending) throw new ApplicationError("NOT_FOUND", "Pending settlement not found.");
  return pending;
}
