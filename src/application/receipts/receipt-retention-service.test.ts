import { describe, expect, it } from "vitest";

import type {
  ReceiptRetentionRepository,
  ReceiptRetentionCursor,
} from "@/application/repositories";
import type { ReceiptMetadata } from "@/domain/records/domain-records";
import { markReceiptContentUserDeleted } from "@/domain/receipts/receipt-content-lifecycle";
import { expenseId, householdId, receiptId, userId } from "@/domain/shared/identifiers";
import { isoInstant, type IsoInstant } from "@/domain/shared/instant";
import { ReceiptRetentionService } from "./receipt-retention-service";

const actor = userId("user-retention-test");

function receipt(id: string, createdAt: IsoInstant): ReceiptMetadata {
  return {
    receiptId: receiptId(id),
    householdId: householdId("house-retention-test"),
    expenseId: expenseId("expense-retention-test"),
    createdByUserId: actor,
    mimeType: "image/png",
    sizeBytes: 10,
    createdAt,
    contentStatus: "available",
  };
}

class FakeRetentionRepository implements ReceiptRetentionRepository {
  readonly metadata = new Map<string, ReceiptMetadata>();
  readonly content = new Set<string>();
  failRemoval = new Set<string>();
  failTransition = new Set<string>();
  onRemoved?: (id: string) => void;

  async findEligibleAvailableReceipts(input: Readonly<{ cutoff: IsoInstant; after?: ReceiptRetentionCursor; limit: number }>) {
    return [...this.metadata.values()]
      .filter((item) => item.contentStatus === "available" && item.createdAt < input.cutoff)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.receiptId.localeCompare(right.receiptId))
      .filter((item) => !input.after || item.createdAt > input.after.createdAt || (item.createdAt === input.after.createdAt && item.receiptId > input.after.receiptId))
      .slice(0, input.limit);
  }

  async removeContentIfPresent(id: ReturnType<typeof receiptId>) {
    if (this.failRemoval.has(id)) throw new Error("storage failed");
    const existed = this.content.delete(id);
    this.onRemoved?.(id);
    return existed ? "removed" as const : "already-missing" as const;
  }

  async markRetentionExpiredConditionally(input: Readonly<{ receiptId: ReturnType<typeof receiptId>; expectedCreatedAt: IsoInstant; removedAt: IsoInstant }>) {
    if (this.failTransition.has(input.receiptId)) throw new Error("metadata failed");
    const current = this.metadata.get(input.receiptId)!;
    if (current.contentStatus !== "available") return "terminal" as const;
    if (current.createdAt !== input.expectedCreatedAt) throw new Error("creation time changed");
    this.metadata.set(input.receiptId, { ...current, contentStatus: "retention-expired", contentRemovedAt: input.removedAt });
    return "transitioned" as const;
  }
}

describe("ReceiptRetentionService", () => {
  const runAt = isoInstant("2026-08-22T06:00:00.000Z");
  const old = isoInstant("2026-05-01T00:00:00.000Z");

  it("processes deterministic bounded pages and skips terminal metadata", async () => {
    const repository = new FakeRetentionRepository();
    for (const id of ["receipt-c", "receipt-a", "receipt-b"]) {
      const value = receipt(id, old);
      repository.metadata.set(id, value);
      repository.content.add(id);
    }
    repository.metadata.set("receipt-terminal", markReceiptContentUserDeleted(receipt("receipt-terminal", old), isoInstant("2026-05-02T00:00:00.000Z"), actor));

    const summary = await new ReceiptRetentionService(repository).run({ now: runAt, batchSize: 2 });

    expect(summary).toMatchObject({ candidatesProcessed: 3, filesRemoved: 3, transitioned: 3, skippedTerminal: 0, failures: 0 });
    expect(repository.metadata.get("receipt-terminal")?.contentStatus).toBe("user-deleted");
  });

  it("leaves metadata available when binary deletion fails", async () => {
    const repository = new FakeRetentionRepository();
    const value = receipt("receipt-storage-failure", old);
    repository.metadata.set(value.receiptId, value);
    repository.content.add(value.receiptId);
    repository.failRemoval.add(value.receiptId);

    const summary = await new ReceiptRetentionService(repository).run({ now: runAt });
    expect(summary.failures).toBe(1);
    expect(repository.metadata.get(value.receiptId)?.contentStatus).toBe("available");
    expect(repository.content.has(value.receiptId)).toBe(true);
  });

  it("recovers a removed binary after a metadata failure on the next run", async () => {
    const repository = new FakeRetentionRepository();
    const value = receipt("receipt-metadata-failure", old);
    repository.metadata.set(value.receiptId, value);
    repository.content.add(value.receiptId);
    repository.failTransition.add(value.receiptId);

    const first = await new ReceiptRetentionService(repository).run({ now: runAt });
    expect(first).toMatchObject({ filesRemoved: 1, failures: 1 });
    expect(repository.metadata.get(value.receiptId)?.contentStatus).toBe("available");

    repository.failTransition.clear();
    const second = await new ReceiptRetentionService(repository).run({ now: isoInstant("2026-08-23T06:00:00.000Z") });
    expect(second).toMatchObject({ filesAlreadyMissing: 1, transitioned: 1, failures: 0 });
    expect(repository.metadata.get(value.receiptId)?.contentStatus).toBe("retention-expired");
  });

  it("lets exactly one terminal state win a manual-delete race", async () => {
    const repository = new FakeRetentionRepository();
    const value = receipt("receipt-race", old);
    repository.metadata.set(value.receiptId, value);
    repository.content.add(value.receiptId);
    repository.onRemoved = (id) => {
      const current = repository.metadata.get(id)!;
      repository.metadata.set(id, markReceiptContentUserDeleted(current, runAt, actor));
    };

    const summary = await new ReceiptRetentionService(repository).run({ now: runAt });
    expect(summary).toMatchObject({ skippedTerminal: 1, transitioned: 0, failures: 0 });
    expect(repository.metadata.get(value.receiptId)?.contentStatus).toBe("user-deleted");
  });
});
