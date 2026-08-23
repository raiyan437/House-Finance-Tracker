"use client";

import { Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CardPaletteOption } from "./card-palette";

const DEMO_CARD_NUMBER_GROUPS = ["4242", "8153", "9021", "3456"] as const;
const DEMO_CARD_EXPIRY = "12/28";

export interface CardDesignPreviewProps {
  readonly option: CardPaletteOption;
  readonly holderName: string;
  readonly cardName: string;
  readonly cardType: string;
  readonly className?: string;
  readonly compact?: boolean;
}

export function CardDesignPreview({
  option,
  holderName,
  cardName,
  cardType,
  className,
  compact = false,
}: CardDesignPreviewProps) {
  const light = option.foreground === "light";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative flex aspect-[1.586] w-full select-none flex-col justify-between overflow-hidden rounded-xl p-4 text-left shadow-[var(--shadow-card)]",
        compact && "rounded-[10px] p-2.5",
        light ? "text-white" : "text-foreground",
        className,
      )}
      style={{ backgroundColor: option.hex }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -right-8 -top-12 size-28 rounded-full opacity-15",
          compact && "-right-5 -top-7 size-16",
          light ? "bg-white" : "bg-white/60",
        )}
      />
      <div className={cn("relative flex items-start justify-between gap-2", compact && "gap-1")}>
        <p className={cn("min-w-0 truncate font-semibold", compact ? "text-[7px]" : "text-sm")}>
          {cardName || "Card Name"}
        </p>
        <span
          aria-hidden="true"
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md border",
            compact ? "size-3.5 rounded-sm" : "size-7",
            light ? "border-white/40 bg-white/25" : "border-black/20 bg-black/10",
          )}
        >
          <Wifi aria-hidden="true" className={cn("rotate-90", compact ? "size-2" : "size-3.5")} />
        </span>
      </div>
      <p className={cn("financial-numerals relative whitespace-nowrap font-medium tracking-[0.08em]", compact ? "text-[8px]" : "text-[15px]")}>
        {DEMO_CARD_NUMBER_GROUPS.join(" ")}
      </p>
      <div className={cn("relative flex items-end justify-between gap-2", compact && "gap-1")}>
        <div className="min-w-0">
          <p className={cn("uppercase tracking-wide", compact ? "text-[5px]" : "text-[8px]")}>Card Holder</p>
          <p className={cn("truncate font-semibold uppercase", compact ? "max-w-20 text-[7px]" : "max-w-40 text-xs")}>
            {holderName || "Your Name"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("uppercase tracking-wide", compact ? "text-[5px]" : "text-[8px]")}>Valid Thru</p>
          <p className={cn("financial-numerals font-semibold", compact ? "text-[7px]" : "text-xs")}>{DEMO_CARD_EXPIRY}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide capitalize",
            compact ? "px-1 py-0 text-[6px]" : "text-mini",
            light ? "bg-black/25" : "bg-black/10",
          )}
        >
          {cardType || "Debit"}
        </span>
      </div>
    </div>
  );
}
