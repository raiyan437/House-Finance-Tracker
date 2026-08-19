import { describe, expect, it } from "vitest";
import { CARD_COLOR_IDS } from "@/domain/cards/card-color";
import { cardFormSchema } from "./card-form.schema";

describe("cardFormSchema", () => {
  it("trims names, permits duplicates externally, and accepts every palette color", () => {
    for (const colorId of CARD_COLOR_IDS) {
      expect(cardFormSchema.parse({ name: "  Personal  ", type: "debit", colorId })).toEqual({
        name: "Personal",
        type: "debit",
        colorId,
      });
    }
  });

  it("accepts Credit and rejects empty names and arbitrary colors", () => {
    expect(cardFormSchema.parse({ name: "Rewards", type: "credit", colorId: "lavender" }).type).toBe("credit");
    expect(cardFormSchema.safeParse({ name: "   ", type: "debit", colorId: "mint" }).success).toBe(false);
    expect(cardFormSchema.safeParse({ name: "Personal", type: "debit", colorId: "#ffffff" }).success).toBe(false);
  });
});
