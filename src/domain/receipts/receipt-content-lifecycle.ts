import {
  assertReceiptMetadata,
  type ReceiptMetadata,
} from "@/domain/records/domain-records";
import { DomainError } from "@/domain/shared/domain-error";
import type { UserId } from "@/domain/shared/identifiers";
import { isoInstant, type IsoInstant } from "@/domain/shared/instant";

export const RECEIPT_RETENTION_TIME_ZONE = "Asia/Dhaka" as const;
export const RECEIPT_RETAINED_CALENDAR_MONTHS = 3 as const;

const dhakaMonthFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RECEIPT_RETENTION_TIME_ZONE,
  calendar: "gregory",
  numberingSystem: "latn",
  year: "numeric",
  month: "2-digit",
});

const dhakaDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RECEIPT_RETENTION_TIME_ZONE,
  calendar: "gregory",
  numberingSystem: "latn",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface CalendarDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function numericPart(parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value || !/^\d+$/.test(value)) {
    throw new DomainError("INVALID_INSTANT", "Receipt retention calendar conversion failed.");
  }
  return Number(value);
}

function dhakaCalendarDateTime(instant: Date): CalendarDateTimeParts {
  const formatted = dhakaDateTimeFormatter.formatToParts(instant);
  return {
    year: numericPart(formatted, "year"),
    month: numericPart(formatted, "month"),
    day: numericPart(formatted, "day"),
    hour: numericPart(formatted, "hour"),
    minute: numericPart(formatted, "minute"),
    second: numericPart(formatted, "second"),
  };
}

function utcMilliseconds(parts: CalendarDateTimeParts): number {
  const value = new Date(0);
  value.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  value.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return value.getTime();
}

function zonedCalendarDateTimeToInstant(target: CalendarDateTimeParts): Date {
  const targetAsUtc = utcMilliseconds(target);
  let candidate = targetAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = dhakaCalendarDateTime(new Date(candidate));
    const difference = targetAsUtc - utcMilliseconds(observed);
    if (difference === 0) break;
    candidate += difference;
  }

  const result = new Date(candidate);
  const observed = dhakaCalendarDateTime(result);
  if (Object.entries(target).some(([key, value]) => observed[key as keyof CalendarDateTimeParts] !== value)) {
    throw new DomainError("INVALID_INSTANT", "Receipt retention cutoff could not be represented in Asia/Dhaka.");
  }
  return result;
}

export function calculateReceiptRetentionCutoff(now: IsoInstant): IsoInstant {
  const validNow = isoInstant(now);
  const parts = dhakaMonthFormatter.formatToParts(new Date(validNow));
  const currentYear = numericPart(parts, "year");
  const currentMonth = numericPart(parts, "month");
  const earliestMonthIndex = currentYear * 12 + currentMonth - RECEIPT_RETAINED_CALENDAR_MONTHS;
  const earliestYear = Math.floor(earliestMonthIndex / 12);
  const earliestMonth = earliestMonthIndex - earliestYear * 12 + 1;
  const cutoff = zonedCalendarDateTimeToInstant({
    year: earliestYear,
    month: earliestMonth,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
  });
  return isoInstant(cutoff.toISOString());
}

export function isReceiptContentExpired(createdAt: IsoInstant, cutoff: IsoInstant): boolean {
  return isoInstant(createdAt) < isoInstant(cutoff);
}

function requireAvailable(metadata: ReceiptMetadata): void {
  assertReceiptMetadata(metadata);
  if (metadata.contentStatus !== "available") {
    throw new DomainError("INVALID_RECEIPT", "Terminal receipt content cannot transition again.");
  }
}

export function markReceiptContentUserDeleted(
  metadata: ReceiptMetadata,
  removedAt: IsoInstant,
  removedByUserId: UserId,
): ReceiptMetadata {
  requireAvailable(metadata);
  const transitioned: ReceiptMetadata = {
    ...metadata,
    contentStatus: "user-deleted",
    contentRemovedAt: isoInstant(removedAt),
    contentRemovedByUserId: removedByUserId,
  };
  assertReceiptMetadata(transitioned);
  return Object.freeze(transitioned);
}

export function markReceiptContentRetentionExpired(
  metadata: ReceiptMetadata,
  removedAt: IsoInstant,
): ReceiptMetadata {
  requireAvailable(metadata);
  const transitioned: ReceiptMetadata = {
    ...metadata,
    contentStatus: "retention-expired",
    contentRemovedAt: isoInstant(removedAt),
  };
  assertReceiptMetadata(transitioned);
  return Object.freeze(transitioned);
}
