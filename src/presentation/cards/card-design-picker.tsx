"use client";

import type { CardColorId } from "@/domain/cards/card-color";
import { CARD_DESIGN_IDS } from "@/domain/cards/card-color";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { CardDesignPreview } from "./card-design-preview";
import { getCardPaletteOption } from "./card-palette";

interface CardDesignPickerProps {
  readonly value: CardColorId;
  readonly onValueChange: (value: CardColorId) => void;
  readonly holderName: string;
  readonly cardName: string;
  readonly cardType: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
}

export function CardDesignPicker({
  value,
  onValueChange,
  holderName,
  cardName,
  cardType,
  disabled,
  invalid,
}: CardDesignPickerProps) {
  return (
    <RadioGroup
      aria-invalid={invalid}
      aria-label="Card Design"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
      disabled={disabled}
      onValueChange={(nextValue) => onValueChange(nextValue as CardColorId)}
      value={value}
    >
      {CARD_DESIGN_IDS.map((id) => {
        const option = getCardPaletteOption(id);
        const selected = value === id;
        return (
          <label
            className={cn(
              "relative block cursor-pointer rounded-xl transition-transform",
              "has-[button:focus-visible]:ring-3 has-[button:focus-visible]:ring-ring/40",
              selected ? "ring-2 ring-foreground ring-offset-2" : "hover:ring-2 hover:ring-ring/30",
              disabled ? "cursor-not-allowed opacity-60" : "",
            )}
            key={id}
          >
            <RadioGroupItem aria-label={option.label} className="absolute inset-0 z-10 size-full opacity-0" value={id} />
            <CardDesignPreview
              cardName={cardName}
              cardType={cardType}
              compact
              holderName={holderName}
              option={option}
            />
          </label>
        );
      })}
    </RadioGroup>
  );
}
