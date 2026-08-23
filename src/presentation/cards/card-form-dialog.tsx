"use client";

import { useState, type RefObject } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  cardFormSchema,
  type CardFormValues,
} from "@/application/validation/card-form.schema";
import type { MyCardSummaryView } from "@/application/cards/card-page";
import { CardDesignPicker } from "./card-design-picker";

interface CardFormDialogProps {
  readonly open: boolean;
  readonly card?: MyCardSummaryView;
  readonly holderName: string;
  readonly restoreFocusRef?: RefObject<HTMLElement | null>;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (values: CardFormValues) => Promise<void>;
}

const EMPTY_VALUES: CardFormValues = {
  name: "",
  type: "debit",
  colorId: "red",
};

export function CardFormDialog({
  open,
  card,
  holderName,
  restoreFocusRef,
  onOpenChange,
  onSubmit,
}: CardFormDialogProps) {
  const [submitError, setSubmitError] = useState<string>();
  const form = useForm<CardFormValues>({
    resolver: zodResolver(cardFormSchema),
    defaultValues: card ? {
      name: card.name,
      type: card.type,
      colorId: card.colorId,
    } : EMPTY_VALUES,
  });

  const pending = form.formState.isSubmitting;
  const type = useWatch({ control: form.control, name: "type" });
  const name = useWatch({ control: form.control, name: "name" });
  const colorId = useWatch({ control: form.control, name: "colorId" });

  async function submit(values: CardFormValues) {
    setSubmitError(undefined);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch {
      setSubmitError("The Card could not be saved. Refresh and try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!pending) onOpenChange(nextOpen); }}>
      <DialogContent
        aria-busy={pending}
        onCloseAutoFocus={(event) => {
          if (!restoreFocusRef?.current) return;
          event.preventDefault();
          restoreFocusRef.current.focus();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          requestAnimationFrame(() => form.setFocus("name"));
        }}
      >
        <DialogHeader>
          <DialogTitle>{card ? "Edit Card" : "Add Card"}</DialogTitle>
          <DialogDescription>
            Private labels help you remember which real-world Card you used. Never enter Card numbers or banking credentials.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={form.handleSubmit(submit)}>
          <div className="space-y-2">
            <Label htmlFor="card-name">Card Name</Label>
            <Input
              aria-describedby={form.formState.errors.name ? "card-name-error" : undefined}
              aria-invalid={Boolean(form.formState.errors.name)}
              autoComplete="off"
              disabled={pending}
              id="card-name"
              {...form.register("name")}
            />
            {form.formState.errors.name ? (
              <p className="text-sm text-danger" id="card-name-error" role="alert">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-label font-medium">Card Type</legend>
            <RadioGroup
              aria-label="Card Type"
              className="grid grid-cols-2 gap-2"
              disabled={pending}
              onValueChange={(value) => form.setValue("type", value as CardFormValues["type"], { shouldValidate: true })}
              value={type}
            >
              {(["debit", "credit"] as const).map((value) => (
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 has-[[data-state=checked]]:border-foreground has-[[data-state=checked]]:ring-2 has-[[data-state=checked]]:ring-foreground/10" key={value}>
                  <RadioGroupItem aria-label={value === "debit" ? "Debit" : "Credit"} value={value} />
                  <span className="capitalize">{value}</span>
                </label>
              ))}
            </RadioGroup>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-label font-medium">Card Design</legend>
            <CardDesignPicker
              cardName={name ?? ""}
              cardType={type}
              disabled={pending}
              holderName={holderName}
              invalid={Boolean(form.formState.errors.colorId)}
              onValueChange={(value) => form.setValue("colorId", value, { shouldValidate: true })}
              value={colorId}
            />
            <p className="text-caption text-text-muted">Card number and expiry are decorative demo values. They are never stored.</p>
          </fieldset>

          {submitError ? <p className="text-sm text-danger" role="alert">{submitError}</p> : null}

          <DialogFooter>
            <Button disabled={pending} onClick={() => onOpenChange(false)} type="button" variant="outline">
              Cancel
            </Button>
            <Button aria-busy={pending} disabled={pending} type="submit">
              {pending ? "Saving…" : card ? "Save Changes" : "Add Card"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
