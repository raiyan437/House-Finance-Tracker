import type { DBSchema } from "idb";

export interface UserProfileRecordV1 {
  recordVersion: 1;
  id: string;
  displayName: string;
  displayEmail: string;
  emailKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface HouseholdRecordV1 {
  recordVersion: 1;
  id: string;
  name: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedByUserId?: string;
}

export interface MembershipRecordV1 {
  recordVersion: 1;
  key: string;
  householdId: string;
  userId: string;
  status: "active" | "former";
  role: "leader" | "member";
  activeMembershipUserKey?: string;
}

export interface JoinRequestRecordV1 {
  recordVersion: 1;
  id: string;
  householdId: string;
  userId: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  createdAt: string;
  resolvedAt?: string;
  resolvedByUserId?: string;
  pendingJoinUserKey?: string;
}

export interface JoinRequestRecordV2 {
  recordVersion: 2;
  id: string;
  householdId: string;
  userId: string;
  status:
    | "pending"
    | "accepted"
    | "rejected"
    | "cancelled"
    | "household-closed";
  createdAt: string;
  resolvedAt?: string;
  resolvedByUserId?: string;
  pendingJoinUserKey?: string;
}

export interface ExpenseRecordV1 {
  recordVersion: 1;
  id: string;
  householdId: string;
  creatorId: string;
  payerId: string;
  name: string;
  amountPoisha: number;
  expenseDate: string;
  splitMethod: "equal" | "amount" | "percentage";
  allocations: readonly { participantId: string; sharePoisha: number }[];
  paymentMethod: "cash" | "card";
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedByUserId?: string;
}

export interface ExpenseRecordV2 {
  recordVersion: 2;
  id: string;
  householdId: string;
  creatorId: string;
  payerId: string;
  name: string;
  amountPoisha: number;
  expenseDate: string;
  splitMethod: "equal" | "amount" | "percentage";
  percentageEntries?: readonly { participantId: string; basisPoints: number }[];
  allocations: readonly { participantId: string; sharePoisha: number }[];
  paymentMethod: "cash" | "card";
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedByUserId?: string;
}

export interface ExpenseRecordV3 {
  recordVersion: 3;
  id: string;
  householdId: string;
  creatorId: string;
  payerId: string;
  name: string;
  amountPoisha: number;
  expenseDate: string;
  splitMethod: "equal" | "amount" | "percentage";
  percentageEntries?: readonly { participantId: string; basisPoints: number }[];
  allocations: readonly { participantId: string; sharePoisha: number }[];
  paymentMethod: "cash" | "card";
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  deletedByUserId?: string;
}

export interface ExpenseCardPrivateRecordV1 {
  recordVersion: 1;
  expenseId: string;
  ownerId: string;
  cardId: string;
  cardNameSnapshot: string;
  cardTypeSnapshot: "debit" | "credit";
  colorSnapshot: string;
}

export interface ExpenseCardPrivateRecordV2 {
  recordVersion: 2;
  expenseId: string;
  ownerId: string;
  cardId: string;
  cardNameSnapshot: string;
  cardTypeSnapshot: "debit" | "credit";
  colorIdSnapshot: "mint" | "powder-blue" | "lavender" | "warm-sand" | "soft-coral" | "charcoal"
    | "red" | "yellow" | "black" | "blue" | "green" | "orange";
}

export interface SettlementRecordV1 {
  recordVersion: 1;
  id: string;
  householdId: string;
  senderId: string;
  receiverId: string;
  amountPoisha: number;
  recommendationHouseholdId: string;
  recommendationSenderId: string;
  recommendationReceiverId: string;
  recommendationAmountPoisha: number;
  createdAt: string;
  status: "pending" | "confirmed" | "rejected" | "cancelled";
  resolvedAt?: string;
  pendingSettlementPairKey?: string;
}

export interface CardRecordV1 {
  recordVersion: 1;
  id: string;
  ownerId: string;
  name: string;
  type: "debit" | "credit";
  color: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface CardRecordV2 {
  recordVersion: 2;
  id: string;
  ownerId: string;
  name: string;
  type: "debit" | "credit";
  colorId: "mint" | "powder-blue" | "lavender" | "warm-sand" | "soft-coral" | "charcoal"
    | "red" | "yellow" | "black" | "blue" | "green" | "orange";
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ReceiptMetadataRecordV1 {
  recordVersion: 1;
  id: string;
  householdId: string;
  expenseId: string;
  createdByUserId: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  originalFilename?: string;
  sizeBytes: number;
  createdAt: string;
  deletedAt?: string;
  deletedByUserId?: string;
}

export interface ReceiptMetadataRecordV2 {
  recordVersion: 2;
  id: string;
  householdId: string;
  expenseId: string;
  createdByUserId: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  originalFilename?: string;
  sizeBytes: number;
  createdAt: string;
  contentStatus: "available" | "user-deleted" | "retention-expired";
  contentRemovedAt?: string;
  contentRemovedByUserId?: string;
}

export interface ReceiptBlobRecordV1 {
  recordVersion: 1;
  receiptId: string;
  blob: Blob;
}

export interface AuditEventRecordV1 {
  recordVersion: 1;
  id: string;
  householdId: string;
  actorId: string;
  aggregateType: "household" | "membership" | "join-request" | "expense" | "settlement" | "card" | "receipt";
  aggregateId: string;
  action: string;
  occurredAt: string;
  changedFields: readonly string[];
}

export interface AppMetaRecordV1 {
  key: string;
  value: string;
}

export interface DevelopmentSessionRecordV1 {
  key: "current";
  currentUserId: string;
}

export interface CommandOutcomeRecordV1 {
  recordVersion: 1;
  key: string;
  actorId: string;
  commandType: "create-expense" | "create-household" | "send-join-request" | "create-pending-settlement" | "upload-receipt" | "create-card";
  commandId: string;
  intentDigest: string;
  resourceId: string;
  completedAt: string;
}

export interface HouseFinanceDatabase extends DBSchema {
  appMeta: { key: string; value: AppMetaRecordV1 };
  userProfiles: { key: string; value: UserProfileRecordV1; indexes: { emailKey: string } };
  households: { key: string; value: HouseholdRecordV1; indexes: { code: string } };
  memberships: { key: string; value: MembershipRecordV1; indexes: { householdId: string; activeMembershipUserKey: string } };
  joinRequests: { key: string; value: JoinRequestRecordV1 | JoinRequestRecordV2; indexes: { householdId: string; pendingJoinUserKey: string } };
  expenses: { key: string; value: ExpenseRecordV3; indexes: { householdId: string; creatorId: string; payerId: string } };
  expenseCardPrivateDetails: { key: string; value: ExpenseCardPrivateRecordV2; indexes: { ownerId: string; cardId: string } };
  settlements: { key: string; value: SettlementRecordV1; indexes: { householdId: string; pendingSettlementPairKey: string } };
  cards: { key: string; value: CardRecordV2; indexes: { ownerId: string } };
  receiptMetadata: {
    key: string;
    value: ReceiptMetadataRecordV2;
    indexes: {
      expenseId: string;
      householdId: string;
      contentStatusCreatedAt: ["available" | "user-deleted" | "retention-expired", string];
      contentStatus: "available" | "user-deleted" | "retention-expired";
      expenseContentStatus: [string, "available" | "user-deleted" | "retention-expired"];
      uploaderContentStatus: [string, "available" | "user-deleted" | "retention-expired"];
    };
  };
  receiptBlobs: { key: string; value: ReceiptBlobRecordV1 };
  auditEvents: { key: string; value: AuditEventRecordV1; indexes: { householdId: string } };
  developmentSession: { key: string; value: DevelopmentSessionRecordV1 };
  commandOutcomes: { key: string; value: CommandOutcomeRecordV1; indexes: { actorId: string } };
}
