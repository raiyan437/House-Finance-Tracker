import type { Poisha } from "@/domain/money/poisha";
import { cn } from "@/lib/utils";
import { formatBdt } from "./format-bdt";

interface MoneyValueProps extends Omit<React.ComponentProps<"span">, "children"> {
  readonly value: Poisha;
}

export function MoneyValue({ value, className, ...props }: MoneyValueProps) {
  return (
    <span
      className={cn("financial-numerals whitespace-nowrap", className)}
      data-slot="money-value"
      {...props}
    >
      {formatBdt(value)}
    </span>
  );
}
