import { describe, expect, it } from "vitest";
import { retainedReceiptCutoff } from "../../../functions/maintenance/src/main.js";

describe("Dhaka three-calendar-month Receipt retention cutoff", () => {
  it.each([
    ["2026-08-27T12:00:00.000Z", "2026-05-31T18:00:00.000Z"],
    ["2026-03-15T00:00:00.000Z", "2025-12-31T18:00:00.000Z"],
    ["2026-01-15T00:00:00.000Z", "2025-10-31T18:00:00.000Z"],
    ["2024-04-15T00:00:00.000Z", "2024-01-31T18:00:00.000Z"],
    ["2024-02-29T17:59:59.999Z", "2023-11-30T18:00:00.000Z"],
  ])("derives the exact calendar cutoff for %s", (now, expected) => {
    expect(retainedReceiptCutoff(new Date(now))).toBe(expected);
  });

  it("expires one millisecond before the cutoff and retains equality", () => {
    const cutoff = retainedReceiptCutoff(new Date("2026-08-27T12:00:00.000Z"));
    expect("2026-05-31T17:59:59.999Z" < cutoff).toBe(true);
    expect(cutoff < cutoff).toBe(false);
    expect("2026-05-31T18:00:00.001Z" < cutoff).toBe(false);
  });
});
