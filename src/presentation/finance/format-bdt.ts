import type { Poisha } from "@/domain/money/poisha";

function groupBangladeshDigits(value: string): string {
  if (value.length <= 3) return value;

  const finalGroup = value.slice(-3);
  const leading = value.slice(0, -3);
  const groups: string[] = [];

  for (let index = leading.length; index > 0; index -= 2) {
    groups.unshift(leading.slice(Math.max(0, index - 2), index));
  }

  return `${groups.join(",")},${finalGroup}`;
}

export function formatBdt(value: Poisha): string {
  const exactValue = BigInt(value);
  const isNegative = exactValue < BigInt(0);
  const absoluteValue = isNegative ? -exactValue : exactValue;
  const taka = absoluteValue / BigInt(100);
  const fraction = absoluteValue % BigInt(100);
  const sign = isNegative ? "-" : "";

  return `${sign}৳${groupBangladeshDigits(taka.toString())}.${fraction
    .toString()
    .padStart(2, "0")}`;
}
