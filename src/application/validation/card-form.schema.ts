import { z } from "zod";
import { CARD_COLOR_IDS } from "@/domain/cards/card-color";

export const cardFormSchema = z.object({
  name: z.string().trim().min(1, "Card Name is required."),
  type: z.enum(["debit", "credit"]),
  colorId: z.enum(CARD_COLOR_IDS),
});

export type CardFormValues = z.infer<typeof cardFormSchema>;
