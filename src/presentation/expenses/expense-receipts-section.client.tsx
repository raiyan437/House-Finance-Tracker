"use client";

import Image from "next/image";
import { Paperclip, Trash2, Upload } from "lucide-react";
import type { ExpenseView } from "@/application/services/application-services";
import { MAX_AVAILABLE_RECEIPTS_PER_EXPENSE } from "@/application/receipts/receipt-storage-policy";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Surface } from "@/presentation/components/surface";
import { CapabilityNotice } from "@/presentation/runtime/capability-gate.client";
import {
  formatReceiptCreatedAt,
  receiptContentStateText,
  RECEIPT_RETENTION_NOTICE,
} from "./expense-ui";
import type {
  ExistingReceiptPreview,
  PendingReceipt,
} from "./expense-form-model";

interface ExpenseReceiptsSectionProps {
  readonly original: ExpenseView | undefined;
  readonly availableReceiptCount: number;
  readonly remainingUploaderReceiptBytes: number;
  readonly receiptMutationsEnabled: boolean;
  readonly addReceiptFiles: (files: FileList | null) => void;
  readonly receiptError: string | undefined;
  readonly existingReceipts: readonly ExistingReceiptPreview[];
  readonly removedReceiptIds: readonly string[];
  readonly stageExistingReceiptRemoval: (receiptId: string) => void;
  readonly pendingReceipts: readonly PendingReceipt[];
  readonly removePendingReceipt: (key: string) => void;
}

function ReceiptPlaceholder({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-28 flex-col items-center justify-center rounded-lg bg-secondary px-3 text-center">
      <Paperclip aria-hidden="true" className="mb-1 size-5 text-text-muted" />
      {children}
    </div>
  );
}

export function ExpenseReceiptsSection({
  original,
  availableReceiptCount,
  remainingUploaderReceiptBytes,
  receiptMutationsEnabled,
  addReceiptFiles,
  receiptError,
  existingReceipts,
  removedReceiptIds,
  stageExistingReceiptRemoval,
  pendingReceipts,
  removePendingReceipt,
}: ExpenseReceiptsSectionProps) {
  return (
    <Surface className="receipts-panel order-2 space-y-3" padding="canonical">
      <div>
        <h2 className="panel-title">Receipts</h2>
        <p className="compact-caption mt-0.5 text-text-muted">
          Optional JPEG, PNG, or WebP images, up to 10 MiB each.
        </p>
        {!original || original.permissions.canUploadReceipt ? (
          <p className="compact-caption mt-1 text-text-muted">
            {availableReceiptCount} of {MAX_AVAILABLE_RECEIPTS_PER_EXPENSE}{" "}
            available ·{" "}
            {Math.floor(remainingUploaderReceiptBytes / (1024 * 1024))} MiB of
            your receipt quota remains
          </p>
        ) : null}
        <p className="compact-caption mt-1 text-text-muted">
          {RECEIPT_RETENTION_NOTICE}
        </p>
      </div>
      {!original || original.permissions.canUploadReceipt ? (
        <div className="grid gap-1">
          {receiptMutationsEnabled ? (
            <Label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
              <Upload className="size-4" /> Add receipt images
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(event) => {
                  addReceiptFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </Label>
          ) : (
            <div
              aria-hidden
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-dashed p-3 text-sm text-text-muted opacity-60"
              data-capability-pending
            >
              <Upload className="size-4" /> Add receipt images
            </div>
          )}
          <CapabilityNotice active={!receiptMutationsEnabled} />
        </div>
      ) : (
        <p className="rounded-xl bg-secondary p-3 text-sm text-text-secondary">
          All active Household members can view available receipts. Only the
          Expense creator can add or remove them.
        </p>
      )}
      {receiptError ? (
        <p className="text-sm text-danger" role="alert">
          {receiptError}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {existingReceipts
          .filter(
            ({ metadata }) => !removedReceiptIds.includes(metadata.receiptId),
          )
          .map(({ metadata, url, error, contentPending }) => {
            const historicalState = receiptContentStateText(
              metadata.contentStatus,
            );
            return (
              <div key={metadata.receiptId} className="rounded-xl border p-3">
                {metadata.contentStatus !== "available" ? (
                  <ReceiptPlaceholder>
                    <p className="text-xs font-medium">
                      {historicalState.title}
                    </p>
                    {historicalState.description ? (
                      <p className="compact-caption mt-1 text-text-muted">
                        {historicalState.description}
                      </p>
                    ) : null}
                  </ReceiptPlaceholder>
                ) : contentPending ? (
                  <ReceiptPlaceholder>
                    <p className="text-xs font-medium">
                      Preview arrives with receipt storage in a later update.
                    </p>
                  </ReceiptPlaceholder>
                ) : url ? (
                  <span className="relative block h-28 overflow-hidden rounded-lg">
                    <Image
                      className="object-cover"
                      src={url}
                      alt={metadata.originalFilename ?? "Expense receipt"}
                      fill
                      sizes="240px"
                      unoptimized
                    />
                  </span>
                ) : (
                  <ReceiptPlaceholder>
                    {error ? (
                      <>
                        <p className="text-xs font-medium">
                          Preview unavailable
                        </p>
                        <p className="compact-caption mt-1 text-text-muted">
                          The stored image could not be displayed. Your file was
                          not changed.
                        </p>
                      </>
                    ) : (
                      <span className="sr-only">Loading receipt preview</span>
                    )}
                  </ReceiptPlaceholder>
                )}
                <p className="mt-2 truncate text-sm">
                  {metadata.originalFilename ?? "Receipt image"}
                </p>
                <p className="compact-caption text-text-muted">
                  Uploaded {formatReceiptCreatedAt(metadata.createdAt)}
                </p>
                {metadata.canRemoveReceipt ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!receiptMutationsEnabled}
                    onClick={() =>
                      stageExistingReceiptRemoval(metadata.receiptId)
                    }
                  >
                    <Trash2 /> Remove
                  </Button>
                ) : null}
              </div>
            );
          })}
        {pendingReceipts.map((receipt) => (
          <div key={receipt.key} className="rounded-xl border p-3">
            <span className="relative block h-28 overflow-hidden rounded-lg">
              <Image
                className="object-cover"
                src={receipt.url}
                alt={receipt.file.name}
                fill
                sizes="240px"
                unoptimized
              />
            </span>
            <p className="mt-2 truncate text-sm">{receipt.file.name}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!receiptMutationsEnabled}
              onClick={() => removePendingReceipt(receipt.key)}
            >
              <Trash2 /> Remove
            </Button>
          </div>
        ))}
      </div>
    </Surface>
  );
}
