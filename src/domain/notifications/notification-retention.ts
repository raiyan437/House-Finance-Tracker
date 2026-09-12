import { isoInstant, type IsoInstant } from "../shared/instant";

export const NOTIFICATION_RETENTION_MONTHS = 3;
export const NOTIFICATION_PAGE_SIZE = 50;
export const NOTIFICATION_LATEST_LIMIT = 5;
export const NOTIFICATION_MARK_ALL_BATCH_SIZE = 50;
export const NOTIFICATION_MAX_OFFSET = 5_000;

function dhakaParts(now: IsoInstant): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit" }).formatToParts(new Date(now));
  return { year: Number(parts.find((part) => part.type === "year")?.value), month: Number(parts.find((part) => part.type === "month")?.value) };
}

export function notificationRetentionCutoffAt(now: IsoInstant): IsoInstant {
  const { year, month } = dhakaParts(now);
  const cutoffMonth = month - (NOTIFICATION_RETENTION_MONTHS - 1);
  const cutoffYear = year + Math.floor((cutoffMonth - 1) / 12);
  const normalizedMonth = ((cutoffMonth - 1) % 12 + 12) % 12 + 1;
  // Dhaka is UTC+06:00 and has no DST; midnight on the first day is canonical.
  return isoInstant(new Date(Date.UTC(cutoffYear, normalizedMonth - 1, 1) - 6 * 60 * 60 * 1000).toISOString());
}
