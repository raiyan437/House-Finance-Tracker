import type { Poisha } from "@/domain/money/poisha";

export function formatBasisPointPercentage(value: number | bigint): string {
  const exact = typeof value === "bigint" ? value : BigInt(value);
  const negative = exact < BigInt(0);
  const absolute = negative ? -exact : exact;
  const whole = absolute / BigInt(100);
  const fraction = absolute % BigInt(100);
  return `${negative ? "-" : ""}${whole}.${fraction.toString().padStart(2, "0")}%`;
}

export function absolutePoisha(value: Poisha): Poisha {
  return Math.abs(value) as Poisha;
}
