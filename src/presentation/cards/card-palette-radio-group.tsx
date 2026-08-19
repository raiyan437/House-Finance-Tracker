"use client";

import type { CardColorId } from "@/domain/cards/card-color";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { CARD_PALETTE } from "./card-palette";

interface CardPaletteRadioGroupProps {
  readonly value: CardColorId;
  readonly onValueChange: (value: CardColorId) => void;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
}

export function CardPaletteRadioGroup({
  value,
  onValueChange,
  disabled,
  invalid,
}: CardPaletteRadioGroupProps) {
  return (
    <RadioGroup
      aria-invalid={invalid}
      aria-label="Card Color"
      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      disabled={disabled}
      onValueChange={(nextValue) => onValueChange(nextValue as CardColorId)}
      value={value}
    >
      {CARD_PALETTE.map((option) => (
        <label
          className={cn(
            "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-2 transition-colors hover:bg-secondary",
            value === option.id ? "border-foreground ring-2 ring-foreground/10" : "border-border",
            disabled ? "cursor-not-allowed opacity-60" : "",
          )}
          key={option.id}
        >
          <RadioGroupItem value={option.id} />
          <span
            aria-hidden="true"
            className="size-7 shrink-0 rounded-full border border-black/10"
            style={{ backgroundColor: option.hex }}
          />
          <span className="text-sm font-medium">{option.label}</span>
        </label>
      ))}
    </RadioGroup>
  );
}
