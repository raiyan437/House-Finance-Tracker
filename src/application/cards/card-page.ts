import type { CardColorId } from "@/domain/cards/card-color";
import type { CardRemovalAction } from "@/domain/cards/card-lifecycle";
import type { Card, CardType } from "@/domain/records/domain-records";
import type { CardId } from "@/domain/shared/identifiers";

export interface MyCardSummaryView {
  readonly cardId: CardId;
  readonly name: string;
  readonly type: CardType;
  readonly colorId: CardColorId;
}

export interface CardPageView {
  readonly cards: readonly MyCardSummaryView[];
}

export interface CardRemovalPreview {
  readonly cardId: CardId;
  readonly name: string;
  readonly expectedAction: CardRemovalAction;
  readonly title: string;
  readonly description: string;
}

export function projectMyCard(card: Card): MyCardSummaryView {
  return Object.freeze({
    cardId: card.cardId,
    name: card.name,
    type: card.type,
    colorId: card.colorId,
  });
}

export function buildCardRemovalPreview(
  card: Card,
  expectedAction: CardRemovalAction,
): CardRemovalPreview {
  return Object.freeze({
    cardId: card.cardId,
    name: card.name,
    expectedAction,
    title: expectedAction === "delete"
      ? `Delete ${card.name}?`
      : `Archive ${card.name}?`,
    description: expectedAction === "delete"
      ? "This card has never been used by an expense and will be permanently removed."
      : "This card has been used by previous expenses. It will no longer be available for new expenses, but historical records will remain unchanged.",
  });
}
