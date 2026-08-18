import { ExpenseDetailsPageClient } from "@/presentation/expenses/expense-details-page.client";

export default async function ExpenseDetailsPage({
  params,
}: {
  params: Promise<{ expenseId: string }>;
}) {
  const { expenseId } = await params;
  return <ExpenseDetailsPageClient expenseId={expenseId} />;
}
