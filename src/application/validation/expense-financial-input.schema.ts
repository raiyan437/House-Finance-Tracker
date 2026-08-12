import {
  DomainError,
  allocateExpense,
  basisPoints,
  expenseDate,
  parseBdtToPoisha,
  parsePercentageToBasisPoints,
  positivePoisha,
  userId,
  type ExpenseFinancialInput,
} from "@/domain";
import { z } from "zod";

const rawSplitSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("equal") }),
  z.object({
    method: z.literal("amount"),
    entries: z.array(
      z.object({
        participantId: z.string(),
        amount: z.string(),
      }),
    ),
  }),
  z.object({
    method: z.literal("percentage"),
    entries: z.array(
      z.object({
        participantId: z.string(),
        percentage: z.string(),
      }),
    ),
  }),
]);

const rawExpenseFinancialInputSchema = z.object({
  creatorId: z.string(),
  payerId: z.string(),
  expenseAmount: z.string(),
  expenseDate: z.string(),
  participantIds: z.array(z.string()),
  split: rawSplitSchema,
});

function reportDomainError(error: unknown, context: z.RefinementCtx): never {
  if (error instanceof DomainError) {
    context.addIssue({
      code: "custom",
      message: `${error.code}: ${error.message}`,
    });
  } else {
    context.addIssue({
      code: "custom",
      message: "INVALID_DOMAIN_INPUT: The financial input is invalid.",
    });
  }

  return z.NEVER;
}

export const expenseFinancialInputSchema = rawExpenseFinancialInputSchema.transform(
  (raw, context): ExpenseFinancialInput => {
    try {
      const base = {
        creatorId: userId(raw.creatorId),
        payerId: userId(raw.payerId),
        expenseAmount: positivePoisha(
          parseBdtToPoisha(raw.expenseAmount),
        ),
        expenseDate: expenseDate(raw.expenseDate),
        participantIds: raw.participantIds.map(userId),
      };

      let input: ExpenseFinancialInput;

      switch (raw.split.method) {
        case "equal":
          input = { ...base, split: { method: "equal" } };
          break;
        case "amount":
          input = {
            ...base,
            split: {
              method: "amount",
              entries: raw.split.entries.map((entry) => ({
                participantId: userId(entry.participantId),
                amount: parseBdtToPoisha(entry.amount),
              })),
            },
          };
          break;
        case "percentage":
          input = {
            ...base,
            split: {
              method: "percentage",
              entries: raw.split.entries.map((entry) => ({
                participantId: userId(entry.participantId),
                basisPoints: basisPoints(
                  parsePercentageToBasisPoints(entry.percentage),
                ),
              })),
            },
          };
          break;
      }

      allocateExpense(input);
      return input;
    } catch (error) {
      return reportDomainError(error, context);
    }
  },
);
