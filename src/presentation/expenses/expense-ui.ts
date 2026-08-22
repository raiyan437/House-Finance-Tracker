import type { ExpenseDate } from "@/domain/dates/expense-date";
import type { BasisPoints } from "@/domain/money/basis-points";
import type { ReceiptContentStatus } from "@/domain/records/domain-records";
import type { IsoInstant } from "@/domain/shared/instant";
import { RECEIPT_RETENTION_TIME_ZONE } from "@/domain/receipts/receipt-content-lifecycle";

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

const receiptCreatedAtFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: RECEIPT_RETENTION_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

export const RECEIPT_RETENTION_NOTICE = "Receipt files are kept for the current month and the previous two calendar months.";

export function formatReceiptCreatedAt(value: IsoInstant): string {
  return receiptCreatedAtFormatter.format(new Date(value));
}

export function receiptContentStateText(status: ReceiptContentStatus): Readonly<{ title: string; description?: string }> {
  if (status === "retention-expired") {
    return { title: "Receipt no longer available", description: RECEIPT_RETENTION_NOTICE };
  }
  if (status === "user-deleted") {
    return { title: "Receipt removed" };
  }
  return { title: "Receipt available" };
}
