"use client";

import { useRef, type RefObject } from "react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MyCardSummaryView } from "@/application/cards/card-page";
import { getCardPaletteOption } from "./card-palette";

interface CardActionsMenuProps {
  readonly card: MyCardSummaryView;
  readonly position: number;
  readonly count: number;
  readonly onEdit: (trigger: RefObject<HTMLButtonElement | null>) => void;
  readonly onRemove: (trigger: RefObject<HTMLButtonElement | null>) => void;
}

export function CardActionsMenu({ card, position, count, onEdit, onRemove }: CardActionsMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const palette = getCardPaletteOption(card.colorId);
  const context = `${card.name}, ${card.type}, ${palette.label}, Card ${position} of ${count}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={`Actions for ${context}`} ref={triggerRef} size="icon" variant="ghost">
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(triggerRef)}>
          <Pencil aria-hidden="true" className="size-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-danger focus:bg-danger-soft" onSelect={() => onRemove(triggerRef)}>
          <Trash2 aria-hidden="true" className="size-4" />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
