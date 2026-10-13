import { describe, expect, it } from "vitest";
import { positivePoisha } from "../money/poisha";
import { householdId, settlementId, userId } from "../shared/identifiers";
import { isoInstant, type IsoInstant } from "../shared/instant";
import type { SettlementRecord } from "../settlements/settlement-types";
import { latestConfirmedSettlementAt } from "./confirmed-settlement-financial-lock";
import { latestConfirmedSettlementBefore } from "./backdated-expense-policy";
import { indexConfirmedSettlementHistory } from "./confirmed-settlement-history";

const house = householdId("indexed-house");
function settlement(
  id: string,
  resolvedAt: string,
  status: SettlementRecord["status"] = "confirmed",
  target = house,
): SettlementRecord {
  const recommendation = {
    householdId: target,
    senderId: userId("sender"),
    receiverId: userId("receiver"),
    amount: positivePoisha(100),
  };
  return {
    ...recommendation,
    settlementId: settlementId(id),
    originatingRecommendation: recommendation,
    createdAt: isoInstant("2026-08-01T00:00:00.000Z"),
    status,
    ...(status === "pending" ? {} : { resolvedAt: isoInstant(resolvedAt) }),
  };
}

describe("request-local confirmed Settlement index", () => {
  it("matches the existing scans across mixed status, household, order, ties and strict boundaries", () => {
    const history = [
      settlement("first-tie", "2026-08-21T18:00:00.000Z"),
      settlement("later", "2026-08-24T00:00:00.000Z"),
      settlement("second-tie", "2026-08-21T18:00:00.000Z"),
      settlement(
        "other-house",
        "2026-08-25T00:00:00.000Z",
        "confirmed",
        householdId("other"),
      ),
      settlement("older", "2026-08-20T00:00:00.000Z"),
      settlement("cancelled", "2026-08-26T00:00:00.000Z", "cancelled"),
      settlement("rejected", "2026-08-27T00:00:00.000Z", "rejected"),
      settlement("pending", "2026-08-28T00:00:00.000Z", "pending"),
    ];
    for (const rows of [history, [...history].reverse()]) {
      const index = indexConfirmedSettlementHistory(house, rows);
      expect(index.latestConfirmedAt).toEqual(
        latestConfirmedSettlementAt(house, rows),
      );
      for (const instant of [
        "2026-08-19T00:00:00.000Z",
        "2026-08-20T00:00:00.000Z",
        "2026-08-21T18:00:00.000Z",
        "2026-08-21T18:00:00.001Z",
        "2026-08-24T00:00:00.000Z",
        "2026-08-29T00:00:00.000Z",
      ]) {
        expect(index.before(isoInstant(instant))).toEqual(
          latestConfirmedSettlementBefore(house, isoInstant(instant), rows),
        );
      }
    }
  });

  it("matches empty and unconfirmed-only history", () => {
    for (const rows of [
      [],
      [settlement("pending", "2026-08-20T00:00:00.000Z", "pending")],
    ]) {
      const index = indexConfirmedSettlementHistory(house, rows);
      expect(index.latestConfirmedAt).toBeUndefined();
      expect(
        index.before(isoInstant("2026-08-30T00:00:00.000Z")),
      ).toBeUndefined();
    }
  });

  it("validates every record even if its household/status could not supply a boundary", () => {
    const malformed = {
      ...settlement(
        "bad",
        "2026-08-20T00:00:00.000Z",
        "cancelled",
        householdId("other"),
      ),
      amount: positivePoisha(200),
    };
    expect(() => latestConfirmedSettlementAt(house, [malformed])).toThrow();
    expect(() => indexConfirmedSettlementHistory(house, [malformed])).toThrow();
    expect(() =>
      indexConfirmedSettlementHistory(house, [
        {
          ...settlement("bad-confirmation", "2026-08-20T00:00:00.000Z"),
          resolvedAt: undefined,
        },
      ]),
    ).toThrow();
  });

  it("rejects invalid query instants and retains the validated snapshot without mutating source rows", () => {
    const row = settlement("snapshot", "2026-08-20T00:00:00.000Z");
    const index = indexConfirmedSettlementHistory(house, [row]);
    expect(() => index.before("invalid" as IsoInstant)).toThrow();
    expect(Object.isFrozen(index)).toBe(true);
    expect(row.resolvedAt).toBe("2026-08-20T00:00:00.000Z");
    expect(
      index.before(isoInstant("2026-08-21T00:00:00.000Z"))?.settlementId,
    ).toBe("snapshot");
  });
});
