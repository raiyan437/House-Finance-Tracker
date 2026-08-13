import { describe, expect, it } from "vitest";
import { poisha } from "@/domain/money/poisha";
import { formatBdt } from "./format-bdt";

describe("formatBdt", () => {
  it("formats exact poisha without using presentation text for arithmetic", () => {
    expect(formatBdt(poisha(425000))).toBe("৳4,250.00");
    expect(formatBdt(poisha(5))).toBe("৳0.05");
    expect(formatBdt(poisha(-125))).toBe("-৳1.25");
  });

  it("uses Bangladesh-style grouping for larger values", () => {
    expect(formatBdt(poisha(1234567890))).toBe("৳1,23,45,678.90");
  });
});
