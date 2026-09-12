import { describe, expect, it } from "vitest";
import { markAllNotificationsReadSchema } from "./route";

describe("mark-all-read command contract", () => {
  it("accepts an empty request only and rejects every client authority field", () => {
    expect(markAllNotificationsReadSchema.safeParse({}).success).toBe(true);
    for (const field of ["userId", "recipientUserId", "notificationIds", "readAt", "cutoff", "timezone"]) {
      expect(markAllNotificationsReadSchema.safeParse({ [field]: "forged" }).success, field).toBe(false);
    }
  });
});
