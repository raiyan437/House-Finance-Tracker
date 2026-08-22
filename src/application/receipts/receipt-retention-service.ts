import type {
  ReceiptRetentionCursor,
  ReceiptRetentionRepository,
} from "@/application/repositories";
import {
  calculateReceiptRetentionCutoff,
  isReceiptContentExpired,
} from "@/domain/receipts/receipt-content-lifecycle";
import type { IsoInstant } from "@/domain/shared/instant";

export interface ReceiptRetentionRunSummary {
  readonly cutoff: IsoInstant;
  readonly candidatesProcessed: number;
  readonly filesRemoved: number;
  readonly filesAlreadyMissing: number;
  readonly transitioned: number;
  readonly skippedTerminal: number;
  readonly failures: number;
}

export class ReceiptRetentionService {
  constructor(private readonly repository: ReceiptRetentionRepository) {}

  async run(input: Readonly<{ now: IsoInstant; batchSize?: number }>): Promise<ReceiptRetentionRunSummary> {
    const batchSize = input.batchSize ?? 100;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
      throw new Error("Receipt retention batch size must be a positive safe integer.");
    }

    const cutoff = calculateReceiptRetentionCutoff(input.now);
    let cursor: ReceiptRetentionCursor | undefined;
    let candidatesProcessed = 0;
    let filesRemoved = 0;
    let filesAlreadyMissing = 0;
    let transitioned = 0;
    let skippedTerminal = 0;
    let failures = 0;

    while (true) {
      const candidates = await this.repository.findEligibleAvailableReceipts({
        cutoff,
        ...(cursor ? { after: cursor } : {}),
        limit: batchSize,
      });
      if (candidates.length === 0) break;

      for (const candidate of candidates) {
        candidatesProcessed += 1;
        if (candidate.contentStatus !== "available" || !isReceiptContentExpired(candidate.createdAt, cutoff)) {
          skippedTerminal += 1;
          continue;
        }

        try {
          const removal = await this.repository.removeContentIfPresent(candidate.receiptId);
          if (removal === "removed") filesRemoved += 1;
          else filesAlreadyMissing += 1;

          const transition = await this.repository.markRetentionExpiredConditionally({
            receiptId: candidate.receiptId,
            expectedCreatedAt: candidate.createdAt,
            removedAt: input.now,
          });
          if (transition === "transitioned") transitioned += 1;
          else skippedTerminal += 1;
        } catch {
          failures += 1;
        }
      }

      const last = candidates.at(-1)!;
      cursor = { createdAt: last.createdAt, receiptId: last.receiptId };
      if (candidates.length < batchSize) break;
    }

    return Object.freeze({
      cutoff,
      candidatesProcessed,
      filesRemoved,
      filesAlreadyMissing,
      transitioned,
      skippedTerminal,
      failures,
    });
  }
}
