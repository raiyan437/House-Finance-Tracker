import { CirclePlus } from "lucide-react";
import { FeaturePlaceholder } from "@/presentation/shell/feature-placeholder";

export default function AddExpensePage() {
  return (
    <FeaturePlaceholder
      description="The Add Expense route is connected for navigation validation. The financial form is introduced later."
      icon={CirclePlus}
      title="Add Expense"
    />
  );
}
