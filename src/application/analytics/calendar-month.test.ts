import { describe, expect, it } from "vitest";
import {
  calendarMonth,
  currentLocalCalendarMonth,
  daysInCalendarMonth,
  formatCalendarMonth,
  previousCalendarMonth,
  tryCalendarMonth,
} from "./calendar-month";

describe("calendar months", () => {
  it("validates canonical input and falls back safely through the caller", () => {
    expect(tryCalendarMonth("2026-08")).toBe("2026-08");
    expect(tryCalendarMonth("2026-8")).toBeUndefined();
    expect(tryCalendarMonth("2026-13")).toBeUndefined();
  });

  it("uses local calendar fields for the current month", () => {
    expect(currentLocalCalendarMonth(new Date(2026, 7, 19, 23, 59))).toBe("2026-08");
  });

  it("handles previous-year rollover and presentation", () => {
    expect(previousCalendarMonth(calendarMonth("2026-01"))).toBe("2025-12");
    expect(formatCalendarMonth(calendarMonth("2026-08"))).toBe("August 2026");
  });

  it("uses exact Gregorian day counts", () => {
    expect(daysInCalendarMonth(calendarMonth("2028-02"))).toBe(29);
    expect(daysInCalendarMonth(calendarMonth("2100-02"))).toBe(28);
    expect(daysInCalendarMonth(calendarMonth("2000-02"))).toBe(29);
    expect(daysInCalendarMonth(calendarMonth("2026-04"))).toBe(30);
    expect(daysInCalendarMonth(calendarMonth("2026-08"))).toBe(31);
  });
});
