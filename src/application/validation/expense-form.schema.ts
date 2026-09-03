import { z } from "zod";
import { EXPENSE_ICON_CATEGORIES } from "@/domain/expenses/expense-icon-category";

export const expenseFormSchema = z.object({
  name: z.string().trim().min(1, "Expense Name is required."),
  iconCategory: z.enum(EXPENSE_ICON_CATEGORIES),
  amountText: z.string(),
  expenseDateText: z.string(),
  paymentMethod: z.enum(["cash", "card"]),
  selectedCardId: z.string(),
  participantIds: z.array(z.string()).min(1, "Select at least one participant."),
  splitMethod: z.enum(["equal", "amount", "percentage"]),
  amountTextByParticipant: z.record(z.string(), z.string()),
  percentageTextByParticipant: z.record(z.string(), z.string()),
});

export type ExpenseFormValues = z.infer<typeof expenseFormSchema>;
