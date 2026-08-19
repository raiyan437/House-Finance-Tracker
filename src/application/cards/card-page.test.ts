import { describe, expect, it } from "vitest";
import { cardId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import type { Card } from "@/domain/records/domain-records";
import { buildCardRemovalPreview, projectMyCard } from "./card-page";

const card: Card = {
  cardId: cardId("card-private"),
  ownerId: userId("owner"),
  name: "Salary Card",
  type: "debit",
  colorId: "mint",
  createdAt: isoInstant("2026-08-18T00:00:00.000Z"),
  updatedAt: isoInstant("2026-08-18T00:00:00.000Z"),
};

describe("Card application projections", () => {
  it("omits owner and persistence metadata from the presentation view", () => {
    expect(projectMyCard(card)).toEqual({
      cardId: card.cardId,
      name: "Salary Card",
      type: "debit",
      colorId: "mint",
    });
  });

  it("uses distinct removal consequences", () => {
    expect(buildCardRemovalPreview(card, "delete")).toMatchObject({
      title: "Delete Salary Card?",
      description: "This card has never been used by an expense and will be permanently removed.",
    });
    expect(buildCardRemovalPreview(card, "archive")).toMatchObject({
      title: "Archive Salary Card?",
      description: "This card has been used by previous expenses. It will no longer be available for new expenses, but historical records will remain unchanged.",
    });
  });
});
