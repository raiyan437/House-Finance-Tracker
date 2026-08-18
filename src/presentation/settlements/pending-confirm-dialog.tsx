"use client";

import { useState } from "react";

import type { PendingSettlementView } from "@/application/settlements/settlement-page";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MoneyValue } from "@/presentation/finance/money-value";

interface PendingConfirmDialogProps {
  readonly settlement: PendingSettlementView;
  readonly loadPreview: () => Promise<PendingSettlementView>;
  readonly onConfirm: () => Promise<void>;
}

export function PendingConfirmDialog({
  settlement,
  loadPreview,
  onConfirm,
}: PendingConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PendingSettlementView>();
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function refreshPreview() {
    setLoading(true);
    setError(undefined);
    try {
      setPreview(await loadPreview());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The payment could not be refreshed.");
    } finally {
      setLoading(false);
    }
  }

  async function confirm(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (pending || !preview) return;
    setPending(true);
    setError(undefined);
    try {
      await onConfirm();
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The payment could not be confirmed.");
    } finally {
      setPending(false);
    }
  }

  const current = preview ?? settlement;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return;
        setOpen(nextOpen);
        if (nextOpen) void refreshPreview();
        else setPreview(undefined);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          aria-label={`Confirm receipt of payment from ${settlement.sender.displayName}`}
          className="w-full sm:w-auto"
        >
          Confirm Received
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Did you receive this payment?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-left">
              <p>
                Confirm that you received <MoneyValue className="font-semibold text-foreground" value={current.amount} /> from {current.sender.displayName} outside the application.
              </p>
              {loading ? <p role="status">Refreshing the current household position…</p> : null}
              {current.warning ? (
                <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-foreground">
                  <p className="font-medium">{current.warning.heading}</p>
                  <p className="mt-1">{current.warning.detail} The original amount is <MoneyValue className="font-semibold" value={current.amount} />.</p>
                </div>
              ) : null}
              {error ? <p className="text-danger" role="alert">{error}</p> : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Not Now</AlertDialogCancel>
          <AlertDialogAction
            aria-busy={pending}
            disabled={pending || loading || !preview}
            onClick={(event) => void confirm(event)}
          >
            {pending ? "Confirming…" : "Confirm Received"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
