import "server-only";
import { z } from "zod";
import { CARD_DESIGN_IDS } from "@/domain/cards/card-color";
import { commandIdentifierInput } from "./household-command-input.server";
import { EXPENSE_ICON_CATEGORIES } from "@/domain/expenses/expense-icon-category";

const poisha = z.number().int().safe().positive();
const share = z.number().int().safe().nonnegative();
const participant = z.object({ participantId: commandIdentifierInput, share }).strict();
const percentageEntry = z.object({ participantId: commandIdentifierInput, basisPoints: z.number().int().min(0).max(10_000) }).strict();
const expenseDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const splitMethod = z.enum(["equal", "amount", "percentage"]);
const noReceiptPayload = z.array(z.never()).max(0).optional();

export const expenseCreateInput = z.object({
  householdId: commandIdentifierInput,
  commandId: commandIdentifierInput,
  backdatedConfirmationToken: z.string().min(1).optional(),
  name: z.string().trim().min(1),
  iconCategory: z.enum(EXPENSE_ICON_CATEGORIES).default("others"),
  amount: poisha,
  expenseDate,
  splitMethod,
  percentageEntries: z.array(percentageEntry).optional(),
  allocations: z.array(participant).min(1),
  payment: z.discriminatedUnion("method", [
    z.object({ method: z.literal("cash") }).strict(),
    z.object({ method: z.literal("card"), cardId: commandIdentifierInput }).strict(),
  ]),
  receipts: noReceiptPayload,
}).strict();

export const expenseEditInput = z.object({
  expenseId: commandIdentifierInput,
  expectedRevision: z.number().int().positive(),
  commandId: commandIdentifierInput,
  backdatedConfirmationToken: z.string().min(1).optional(),
  name: z.string().trim().min(1),
  iconCategory: z.enum(EXPENSE_ICON_CATEGORIES).default("others"),
  amount: poisha,
  expenseDate,
  splitMethod,
  percentageEntries: z.array(percentageEntry).optional(),
  allocations: z.array(participant).min(1),
  payment: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("preserve") }).strict(),
    z.object({ kind: z.literal("cash"), confirmedPrivateReferenceDetachment: z.boolean() }).strict(),
    z.object({ kind: z.literal("card"), cardId: commandIdentifierInput }).strict(),
  ]),
  newReceipts: noReceiptPayload,
  removedReceiptIds: z.array(commandIdentifierInput).max(0).optional(),
}).strict();

export const expenseDeleteInput = z.object({
  expenseId: commandIdentifierInput,
  expectedRevision: z.number().int().positive(),
  commandId: commandIdentifierInput,
}).strict();

export const expenseCommentCreateInput = z.object({
  expenseId: commandIdentifierInput,
  commandId: commandIdentifierInput,
  body: z.string().max(1000),
}).strict();

export const settlementRecommendationInput = z.object({
  householdId: commandIdentifierInput,
  senderId: commandIdentifierInput,
  receiverId: commandIdentifierInput,
  amount: poisha,
}).strict();

export const settlementCreateInput = z.object({
  recommendation: settlementRecommendationInput,
  commandId: commandIdentifierInput,
}).strict();

export const settlementTransitionInput = z.object({
  settlementId: commandIdentifierInput,
  commandId: commandIdentifierInput,
}).strict();

export const productionCardDesign = z.enum(CARD_DESIGN_IDS);
