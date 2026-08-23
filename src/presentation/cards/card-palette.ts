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
  { id: "charcoal", label: "Black", hex: "#171717", foreground: "light" },
  { id: "red", label: "Red", hex: "#B91C1C", foreground: "light" },
  { id: "yellow", label: "Yellow", hex: "#F0B429", foreground: "dark" },
  { id: "black", label: "Black", hex: "#111111", foreground: "light" },
  { id: "blue", label: "Blue", hex: "#1D4ED8", foreground: "light" },
  { id: "green", label: "Green", hex: "#15803D", foreground: "light" },
  { id: "orange", label: "Orange", hex: "#C2410C", foreground: "light" },
]);

export function getCardPaletteOption(id: CardColorId): CardPaletteOption {
  return CARD_PALETTE.find((option) => option.id === id)!;
}
