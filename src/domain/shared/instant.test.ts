import { describe, expect, it } from "vitest";

import { DomainError } from "./domain-error";
import { isoInstant } from "./instant";

describe("ISO instant", () => {
  it("accepts a canonical UTC system timestamp", () => {
    expect(isoInstant("2026-08-12T16:00:00.000Z")).toBe(
      "2026-08-12T16:00:00.000Z",
    );
  });

  it.each([
    "",
    "2026-08-12",
    "2026-08-12T16:00:00Z",
    "2026-08-12T16:00:00.000+00:00",
    "2026-02-29T16:00:00.000Z",
    "2026-13-12T16:00:00.000Z",
  ])("rejects non-canonical or invalid timestamp %s", (value) => {
    expect(() => isoInstant(value)).toThrowError(
      expect.objectContaining<Partial<DomainError>>({ code: "INVALID_INSTANT" }),
    );
  });
});
