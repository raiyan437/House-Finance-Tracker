import { ReceiptRetentionService } from "@/application/receipts/receipt-retention-service";
import type { ReceiptRetentionRepository } from "@/application/repositories";
import { isoInstant, type IsoInstant } from "@/domain/shared/instant";

export interface LocalReceiptRetentionSweepResult {
  readonly ran: boolean;
  readonly removedFiles?: number;
  readonly failures?: number;
}

export async function sweepExpiredLocalReceiptContent(
  repository: ReceiptRetentionRepository,
  options: Readonly<{ now?: IsoInstant; log?: (message: string) => void }> = {},
): Promise<LocalReceiptRetentionSweepResult> {
  const log = options.log ?? ((message: string) => console.warn(message));
  try {
    const now = options.now ?? isoInstant(new Date().toISOString());
    const summary = await new ReceiptRetentionService(repository).run({ now });
    if (summary.failures > 0) {
      log(
        `Local receipt retention finished with ${summary.failures} failure(s) ` +
          `(removed ${summary.filesRemoved}, first failure: ${summary.failuresDetail[0]?.reason ?? "unknown"}). ` +
          "Expired content stays eligible and is retried on the next startup.",
      );
    }
    return Object.freeze({
      ran: true,
      ...(summary.failures > 0 ? { failures: summary.failures } : {}),
      ...(summary.filesRemoved > 0 ? { removedFiles: summary.filesRemoved } : {}),
    });
  } catch (error) {
    log(`Local receipt retention could not run: ${error instanceof Error ? error.message : String(error)}`);
    return Object.freeze({ ran: false });
  }
}
