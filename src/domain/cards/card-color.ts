import { DomainError } from "@/domain/shared/domain-error";

export const CARD_COLOR_IDS = [
  "mint",
  "powder-blue",
  "lavender",
  "warm-sand",
  "soft-coral",
  "charcoal",
] as const;

export type CardColorId = (typeof CARD_COLOR_IDS)[number];

export function cardColorId(value: string): CardColorId {
  if (!(CARD_COLOR_IDS as readonly string[]).includes(value)) {
    throw new DomainError("INVALID_CARD", "Unsupported Card color.");
  }
  return value as CardColorId;
}
