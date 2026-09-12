import { describe, expect, it } from "vitest";
import { isoInstant } from "../shared/instant";
import { notificationRetentionCutoffAt } from "./notification-retention";

describe("notification retention policy", () => {
  it("uses the current and previous two Dhaka calendar months", () => {
    const cutoff = notificationRetentionCutoffAt(isoInstant("2026-09-12T03:00:00.000Z"));
    expect(cutoff).toBe("2026-06-30T18:00:00.000Z");
    expect(isoInstant("2026-06-30T17:59:59.999Z") < cutoff).toBe(true);
    expect(isoInstant("2026-06-30T18:00:00.000Z") >= cutoff).toBe(true);
  });

  it("rolls over on the first day of the Dhaka calendar month", () => {
    expect(notificationRetentionCutoffAt(isoInstant("2026-10-01T00:01:00.000Z"))).toBe("2026-07-31T18:00:00.000Z");
    expect(notificationRetentionCutoffAt(isoInstant("2026-01-15T06:00:00.000Z"))).toBe("2025-10-31T18:00:00.000Z");
  });
});
