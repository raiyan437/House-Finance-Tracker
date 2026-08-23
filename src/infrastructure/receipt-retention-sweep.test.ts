import { describe, expect, it } from "vitest";

import type {
  ReceiptRetentionCursor,
  ReceiptRetentionRepository,
} from "@/application/repositories";
import type { ReceiptMetadata } from "@/domain/records/domain-records";
import { expenseId, householdId, receiptId, userId } from "@/domain/shared/identifiers";
import { isoInstant, type IsoInstant } from "@/domain/shared/instant";
import { sweepExpiredLocalReceiptContent } from "./receipt-retention-sweep";

const now = isoInstant("2026-08-22T06:00:00.000Z");
const old = isoInstant("2026-05-01T00:00:00.000Z");

function expiredReceipt(id: string): ReceiptMetadata {
  return {
    receiptId: receiptId(id),
    householdId: householdId("house-sweep"),
    expenseId: expenseId("expense-sweep"),
    createdByUserId: userId("user-sweep"),
    mimeType: "image/png",
    sizeBytes: 10,
    createdAt: old,
    contentStatus: "available",
  };
}

class StubRetentionRepository implements ReceiptRetentionRepository {
  metadata = new Map<string, ReceiptMetadata>();
  failTransition = new Set<string>();
  throwOnList = false;

  async findEligibleAvailableReceipts(input: Readonly<{ cutoff: IsoInstant; after?: ReceiptRetentionCursor; limit: number }>) {
    if (this.throwOnList) throw new Error("database unavailable");
    return [...this.metadata.values()].filter((item) => item.createdAt < input.cutoff).slice(0, input.limit);
  }

  async removeContentIfPresent(id: ReturnType<typeof receiptId>) {
    return this.metadata.has(id) ? ("removed" as const) : ("already-missing" as const);
  }

  async markRetentionExpiredConditionally(input: Readonly<{ receiptId: ReturnType<typeof receiptId>; expectedCreatedAt: IsoInstant; removedAt: IsoInstant }>) {
    if (this.failTransition.has(input.receiptId)) throw new Error("metadata write failed");
    this.metadata.delete(input.receiptId);
    return "transitioned" as const;
  }
}

describe("sweepExpiredLocalReceiptContent", () => {
  it("removes eligible content during a clean sweep without logging", async () => {
    const repository = new StubRetentionRepository();
    repository.metadata.set("receipt-clean", expiredReceipt("receipt-clean"));
    const logs: string[] = [];

    const result = await sweepExpiredLocalReceiptContent(repository, { now, log: (message) => logs.push(message) });

    expect(result).toEqual({ ran: true, removedFiles: 1 });
    expect(logs).toEqual([]);
    expect(repository.metadata.size).toBe(0);
  });

  it("surfaces per-receipt failures through the log while staying non-fatal", async () => {
    const repository = new StubRetentionRepository();
    repository.metadata.set("receipt-failing", expiredReceipt("receipt-failing"));
    repository.failTransition.add(repository.metadata.get("receipt-failing")!.receiptId);
    const logs: string[] = [];

    const result = await sweepExpiredLocalReceiptContent(repository, { now, log: (message) => logs.push(message) });

    expect(result).toEqual({ ran: true, failures: 1, removedFiles: 1 });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("1 failure(s)");
    expect(logs[0]).toContain("metadata write failed");
  });

  it("reports a total sweep failure and never throws", async () => {
    const repository = new StubRetentionRepository();
    repository.throwOnList = true;
    const logs: string[] = [];

    const result = await sweepExpiredLocalReceiptContent(repository, { now, log: (message) => logs.push(message) });

    expect(result).toEqual({ ran: false });
    expect(logs).toEqual(["Local receipt retention could not run: database unavailable"]);
  });
});
