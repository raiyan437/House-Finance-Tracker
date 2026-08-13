import { ReceiptText } from "lucide-react";
import { FeaturePlaceholder } from "@/presentation/shell/feature-placeholder";

export default function ExpensesPage() {
  return (
    <FeaturePlaceholder
      description="Expense browsing and filters are intentionally reserved for the Expenses feature phase."
      icon={ReceiptText}
      title="Expenses"
    />
  );
}
