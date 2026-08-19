import type { CardColorId } from "@/domain/cards/card-color";

export interface CardPaletteOption {
  readonly id: CardColorId;
  readonly label: string;
  readonly hex: string;
  readonly foreground: "dark" | "light";
}

export const CARD_PALETTE: readonly CardPaletteOption[] = Object.freeze([
  { id: "mint", label: "Mint", hex: "#CFF4E2", foreground: "dark" },
  { id: "powder-blue", label: "Powder Blue", hex: "#DDEBFF", foreground: "dark" },
  { id: "lavender", label: "Lavender", hex: "#E8E1FF", foreground: "dark" },
  { id: "warm-sand", label: "Warm Sand", hex: "#F4E7D3", foreground: "dark" },
  { id: "soft-coral", label: "Soft Coral", hex: "#FFDCD5", foreground: "dark" },
  { id: "charcoal", label: "Charcoal", hex: "#282828", foreground: "light" },
]);

export function getCardPaletteOption(id: CardColorId): CardPaletteOption {
  return CARD_PALETTE.find((option) => option.id === id)!;
}
