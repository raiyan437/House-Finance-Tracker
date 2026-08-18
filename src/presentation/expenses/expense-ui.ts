import type { ExpenseDate } from "@/domain/dates/expense-date";
import type { BasisPoints } from "@/domain/money/basis-points";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function currentLocalDateText(now = new Date()): string {
  const year = now.getFullYear().toString().padStart(4, "0");
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function currentLocalMonth(now = new Date()): string {
  return currentLocalDateText(now).slice(0, 7);
}

export function formatExpenseDate(value: ExpenseDate): string {
  const [year, month, day] = value.split("-");
  const monthIndex = Number(month) - 1;
  return `${Number(day)} ${MONTHS[monthIndex] ?? month} ${year}`;
}

export function formatBasisPoints(value: BasisPoints): string {
  const whole = Math.floor(value / 100);
  const fraction = value % 100;
  return fraction === 0
    ? whole.toString()
    : `${whole}.${fraction.toString().padStart(2, "0")}`;
}

export function selectClassName(): string {
  return "h-11 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20";
}
