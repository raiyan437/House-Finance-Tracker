"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const renameSchema = z.object({
  name: z.string().trim().min(1, "The House name cannot be empty."),
});

type RenameFormValues = z.infer<typeof renameSchema>;

export function RenameHouseholdDialog({
  currentName,
  restoreFocusRef,
  onOpenChange,
  onSubmit,
}: Readonly<{
  currentName: string;
  restoreFocusRef: React.RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
}>) {
  const [submitError, setSubmitError] = useState<string>();
  const form = useForm<RenameFormValues>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name: currentName },
  });

  const pending = form.formState.isSubmitting;

  async function submit(values: RenameFormValues) {
    setSubmitError(undefined);
    try {
      await onSubmit(values.name);
      onOpenChange(false);
    } catch {
      setSubmitError("The House name could not be saved. Refresh and try again.");
    }
  }

  return (
    <Dialog open onOpenChange={(nextOpen) => { if (!pending) onOpenChange(nextOpen); }}>
      <DialogContent
        aria-busy={pending}
        onCloseAutoFocus={(event) => {
          if (!restoreFocusRef?.current?.isConnected) return;
          event.preventDefault();
          restoreFocusRef.current.focus();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => form.setFocus("name"));
        }}
      >
        <DialogHeader>
          <DialogTitle>Rename Household</DialogTitle>
          <DialogDescription>
            Only the House name changes. The House code, members, and all financial history stay exactly the same.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={form.handleSubmit(submit)}>
          <div className="space-y-2">
            <Label htmlFor="house-name">House name</Label>
            <Input
              aria-describedby={form.formState.errors.name ? "house-name-error" : undefined}
              aria-invalid={Boolean(form.formState.errors.name)}
              autoComplete="off"
              disabled={pending}
              id="house-name"
              {...form.register("name")}
            />
            {form.formState.errors.name ? (
              <p className="text-sm text-danger" id="house-name-error" role="alert">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>

          {submitError ? <p className="text-sm text-danger" role="alert">{submitError}</p> : null}

          <DialogFooter>
            <Button disabled={pending} onClick={() => onOpenChange(false)} type="button" variant="outline">
              Cancel
            </Button>
            <Button aria-busy={pending} disabled={pending} type="submit">
              <Pencil aria-hidden="true" /> {pending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
