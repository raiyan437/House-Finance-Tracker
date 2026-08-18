import { ExpenseFormPageClient } from "@/presentation/expenses/expense-form-page.client";

export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ expenseId: string }>;
}) {
  const { expenseId } = await params;
  return <ExpenseFormPageClient mode="edit" expenseId={expenseId} />;
}
