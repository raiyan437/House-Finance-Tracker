import Image from "next/image";
import { expenseIconCategory, type ExpenseIconCategory } from "@/domain/expenses/expense-icon-category";

export interface ExpenseIconOption {
  readonly value: ExpenseIconCategory;
  readonly label: string;
  readonly iconAsset: string;
  readonly order: number;
  readonly author: string;
  readonly sourceUrl: string;
}

export const EXPENSE_ICON_OPTIONS: readonly ExpenseIconOption[] = Object.freeze([
  { value: "internet", label: "Wifi", iconAsset: "/icons/expense-categories/wifi.png", order: 1, author: "Magnific", sourceUrl: "https://www.flaticon.com/free-icon/wifi_929464" },
  { value: "electricity", label: "Electricity", iconAsset: "/icons/expense-categories/electricity.png", order: 2, author: "Vectors Market", sourceUrl: "https://www.flaticon.com/free-icon/idea_427735" },
  { value: "gas", label: "Gas", iconAsset: "/icons/expense-categories/gas.png", order: 3, author: "Robert Angle", sourceUrl: "https://www.flaticon.com/free-icon/gas-cylinder_9747073" },
  { value: "groceries", label: "Groceries", iconAsset: "/icons/expense-categories/groceries.png", order: 4, author: "justicon", sourceUrl: "https://www.flaticon.com/free-icon/shopping-bag_3514242" },
  { value: "food", label: "Food", iconAsset: "/icons/expense-categories/food.png", order: 5, author: "Viktor Turchyn", sourceUrl: "https://www.flaticon.com/free-icon/fast-food_9718703" },
  { value: "entertainment", label: "Entertainment", iconAsset: "/icons/expense-categories/entertainment.png", order: 6, author: "Magnific", sourceUrl: "https://www.flaticon.com/free-icon/cinema_1655749" },
  { value: "cigarettes", label: "Cigarettes", iconAsset: "/icons/expense-categories/cigarettes.png", order: 7, author: "Magnific", sourceUrl: "https://www.flaticon.com/free-icon/cigarette_595593" },
  { value: "pets", label: "Pet", iconAsset: "/icons/expense-categories/pet.png", order: 8, author: "amonrat rungreangfangsai", sourceUrl: "https://www.flaticon.com/free-icon/black-cat_3704886" },
  { value: "repairs", label: "Repair", iconAsset: "/icons/expense-categories/repair.png", order: 9, author: "Magnific", sourceUrl: "https://www.flaticon.com/free-icon/repair_939119" },
  { value: "housing", label: "Household", iconAsset: "/icons/expense-categories/household.png", order: 10, author: "Magnific", sourceUrl: "https://www.flaticon.com/free-icon/house_619032" },
  { value: "loan", label: "Loan", iconAsset: "/icons/expense-categories/loan.png", order: 11, author: "Smashicons", sourceUrl: "https://www.flaticon.com/free-icon/signing_3146444" },
  { value: "others", label: "Other", iconAsset: "/icons/expense-categories/other.png", order: 12, author: "Prosymbols Premium", sourceUrl: "https://www.flaticon.com/free-icon/delivery-box_6833470" },
]);

const optionByValue = new Map(EXPENSE_ICON_OPTIONS.map((option) => [option.value, option]));

export function expenseIconOption(value: ExpenseIconCategory | undefined): ExpenseIconOption {
  return optionByValue.get(expenseIconCategory(value)) ?? EXPENSE_ICON_OPTIONS[EXPENSE_ICON_OPTIONS.length - 1]!;
}

function classNames(...names: readonly (string | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

export function ExpenseIconGraphic({ category, className }: Readonly<{ category?: ExpenseIconCategory; className?: string }>) {
  const { iconAsset } = expenseIconOption(category);
  return (
    <span aria-hidden="true" className={classNames("pointer-events-none relative inline-flex shrink-0 items-center justify-center", className)}>
      <Image alt="" className="pointer-events-none object-contain" fill sizes="24px" src={iconAsset} unoptimized />
    </span>
  );
}

export function ExpenseSemanticIcon({ category, className }: Readonly<{ category?: ExpenseIconCategory; className?: string }>) {
  const { label } = expenseIconOption(category);
  return (
    <span aria-label={`${label} category`} className={classNames("relative inline-flex shrink-0 items-center justify-center", className)} role="img">
      <ExpenseIconGraphic category={category} className="size-full" />
    </span>
  );
}
