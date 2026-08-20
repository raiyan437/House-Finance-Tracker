import type { IsoInstant } from "@/domain/shared/instant";

declare const calendarMonthBrand: unique symbol;

export type CalendarMonth = string & {
  readonly [calendarMonthBrand]: "CalendarMonth";
};

const CALENDAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function tryCalendarMonth(value: string): CalendarMonth | undefined {
  return CALENDAR_MONTH.test(value) ? (value as CalendarMonth) : undefined;
}

export function calendarMonth(value: string): CalendarMonth {
  const parsed = tryCalendarMonth(value);
  if (!parsed) throw new Error("A calendar month must use the YYYY-MM format.");
  return parsed;
}

function parts(value: CalendarMonth): Readonly<{ year: number; month: number }> {
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) };
}

function fromParts(year: number, month: number): CalendarMonth {
  return calendarMonth(`${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}`);
}

export function currentLocalCalendarMonth(now = new Date()): CalendarMonth {
  return fromParts(now.getFullYear(), now.getMonth() + 1);
}

export function localCalendarMonthFromInstant(instant: IsoInstant): CalendarMonth {
  return currentLocalCalendarMonth(new Date(instant));
}

export function previousCalendarMonth(value: CalendarMonth): CalendarMonth {
  const { year, month } = parts(value);
  return month === 1 ? fromParts(year - 1, 12) : fromParts(year, month - 1);
}

export function daysInCalendarMonth(value: CalendarMonth): number {
  const { year, month } = parts(value);
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function formatCalendarMonth(value: CalendarMonth): string {
  const { year, month } = parts(value);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function expenseDateIsInMonth(expenseDate: string, month: CalendarMonth): boolean {
  return expenseDate.slice(0, 7) === month;
}

export function compareCalendarMonths(left: CalendarMonth, right: CalendarMonth): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
