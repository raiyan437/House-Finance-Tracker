"use client";

import { useState, type RefObject } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { CardRemovalPreview } from "@/application/cards/card-page";

interface RemoveCardDialogProps {
  readonly preview?: CardRemovalPreview;
  readonly restoreFocusRef?: RefObject<HTMLElement | null>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: (preview: CardRemovalPreview) => Promise<"removed" | "refreshed">;
}

export function RemoveCardDialog({
  preview,
  restoreFocusRef,
  onOpenChange,
  onConfirm,
}: RemoveCardDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!preview || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const result = await onConfirm(preview);
      if (result === "removed") onOpenChange(false);
      else setError("This Card is now used by an Expense. Review and confirm the updated Archive action.");
    } catch {
      setError("The Card could not be removed. Refresh and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={Boolean(preview)} onOpenChange={(open) => { if (!pending) onOpenChange(open); }}>
      <AlertDialogContent
        aria-busy={pending}
        onCloseAutoFocus={(event) => {
          if (!restoreFocusRef?.current?.isConnected) return;
          event.preventDefault();
          restoreFocusRef.current.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{preview?.title}</AlertDialogTitle>
          <AlertDialogDescription>{preview?.description}</AlertDialogDescription>
          {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            aria-busy={pending}
            disabled={pending}
            onClick={(event) => void confirm(event)}
            variant={preview?.expectedAction === "delete" ? "destructive" : "default"}
          >
            {pending ? "Working…" : preview?.expectedAction === "delete" ? "Delete Card" : "Archive Card"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
