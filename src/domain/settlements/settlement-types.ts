import type { PositivePoisha } from "../money/poisha";
import type {
  HouseholdId,
  SettlementId,
  UserId,
} from "../shared/identifiers";
import type { IsoInstant } from "../shared/instant";

export type SettlementStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "cancelled";

export interface SettlementRecommendation {
  readonly householdId: HouseholdId;
  readonly senderId: UserId;
  readonly receiverId: UserId;
  readonly amount: PositivePoisha;
}

export interface SettlementRecord {
  readonly settlementId: SettlementId;
  readonly householdId: HouseholdId;
  readonly senderId: UserId;
  readonly receiverId: UserId;
  readonly amount: PositivePoisha;
  readonly originatingRecommendation: SettlementRecommendation;
  readonly createdAt: IsoInstant;
  readonly status: SettlementStatus;
  readonly resolvedAt?: IsoInstant;
}

export type SettlementStaleness =
  | "current"
  | "amount-changed"
  | "recommendation-absent"
  | "direction-reversed";
