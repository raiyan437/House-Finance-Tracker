import {
  Cigarette, Flame, House, PawPrint, Popcorn, Shapes,
  ShoppingBasket, Utensils, Wifi, Wrench,
  type LucideIcon,
} from "lucide-react";
import { expenseIconCategory, type ExpenseIconCategory } from "@/domain/expenses/expense-icon-category";

export const EXPENSE_ICON_OPTIONS: readonly Readonly<{
  value: ExpenseIconCategory;
  label: string;
  Icon: LucideIcon;
}>[] = Object.freeze([
  { value: "internet", label: "Internet", Icon: Wifi },
  { value: "gas", label: "Gas", Icon: Flame },
  { value: "groceries", label: "Groceries", Icon: ShoppingBasket },
  { value: "food", label: "Food", Icon: Utensils },
  { value: "entertainment", label: "Entertainment", Icon: Popcorn },
  { value: "cigarettes", label: "Cigarettes", Icon: Cigarette },
  { value: "pets", label: "Pets", Icon: PawPrint },
  { value: "repairs", label: "Repairs", Icon: Wrench },
  { value: "housing", label: "Housing", Icon: House },
  { value: "others", label: "Others", Icon: Shapes },
]);

const optionByValue = new Map(EXPENSE_ICON_OPTIONS.map((option) => [option.value, option]));

export function expenseIconOption(value: ExpenseIconCategory | undefined) {
  return optionByValue.get(expenseIconCategory(value))!;
}

export function ExpenseSemanticIcon({ category, className }: Readonly<{ category?: ExpenseIconCategory; className?: string }>) {
  const { Icon, label } = expenseIconOption(category);
  return <Icon aria-label={`${label} category`} className={className} role="img" />;
}
