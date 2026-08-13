"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type MoneyInputProps = Omit<React.ComponentProps<typeof Input>, "type">;

export function MoneyInput({ className, ...props }: MoneyInputProps) {
  return (
    <div className="relative" data-slot="money-input">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-medium text-text-secondary"
      >
        ৳
      </span>
      <Input
        className={cn("financial-numerals pl-8", className)}
        inputMode="decimal"
        type="text"
        {...props}
      />
    </div>
  );
}
