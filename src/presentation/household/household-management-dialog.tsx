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
import { ApplicationError } from "@/application/errors/application-error";
import { toast } from "sonner";

export type HouseholdDialogAction = "leave" | "remove" | "transfer" | "delete";

function dialogCopy(
  action: HouseholdDialogAction,
  householdName: string,
  memberName?: string,
): Readonly<{ title: string; description: string; confirmLabel: string; destructive: boolean }> {
  if (action === "leave") {
    return {
      title: `Leave ${householdName}?`,
      description: "You will lose active household access. Your historical membership and financial records will be preserved.",
      confirmLabel: "Leave Household",
      destructive: true,
    };
  }
  if (action === "remove") {
    return {
      title: `Remove ${memberName ?? "this member"}?`,
      description: "They will lose active household access. Their historical membership and financial records will be preserved.",
      confirmLabel: "Remove Member",
      destructive: true,
    };
  }
  if (action === "transfer") {
    return {
      title: `Transfer leadership to ${memberName ?? "this member"}?`,
      description: `${memberName ?? "This member"} will become the House Leader and receive household-management permissions. You will remain a normal household member.`,
      confirmLabel: "Transfer Leadership",
      destructive: false,
    };
  }
  return {
    title: `Delete ${householdName}?`,
    description: "This will close the household for all members. Historical financial records will be preserved, but the household can no longer be used.",
    confirmLabel: "Delete Household",
    destructive: true,
  };
}

export function HouseholdManagementDialog({
  action,
  householdName,
  memberName,
  open,
  restoreFocusRef,
  onOpenChange,
  onConfirm,
}: Readonly<{
  action: HouseholdDialogAction;
  householdName: string;
  memberName?: string;
  open: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const copy = dialogCopy(action, householdName, memberName);

  async function confirm(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (caught) {
      if (caught instanceof ApplicationError && caught.code === "HOUSEHOLD_STATE_CHANGED") {
        toast.error("Household information changed. Review the current status and confirm again if the action is still available.");
        onOpenChange(false);
      } else {
        setError("The action could not be completed. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) setError(undefined);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent
        aria-busy={pending}
        onCloseAutoFocus={(event) => {
          if (!restoreFocusRef?.current?.isConnected) return;
          event.preventDefault();
          restoreFocusRef.current.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.description}</AlertDialogDescription>
          {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            aria-busy={pending}
            disabled={pending}
            onClick={(event) => void confirm(event)}
            variant={copy.destructive ? "destructive" : "default"}
          >
            {pending ? "Working…" : copy.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
