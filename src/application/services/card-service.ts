import { ApplicationError } from "../errors/application-error";
import { assertIdempotentIntent, canonicalIntentDigest, type IdempotencyDescriptor } from "../idempotency/command-idempotency";
import type { CardColorId } from "@/domain/cards/card-color";
import type { CardRemovalAction, CardRemovalResult } from "@/domain/cards/card-lifecycle";
import { assertCard, type Card } from "@/domain/records/domain-records";
import { cardId, type CardId } from "@/domain/shared/identifiers";
import { commandId, type CommandId } from "@/domain/shared/identifiers";
import { buildCardRemovalPreview, projectMyCard, type CardPageView, type CardRemovalPreview, type MyCardSummaryView } from "@/application/cards/card-page";
import { type Dependencies } from "./service-context";


export class CardApplicationService {
  constructor(private readonly deps: Dependencies) {}

  async getMyCards(): Promise<CardPageView> {
    const actor = await this.deps.session.getCurrentUserId();
    const cards = await this.deps.repositories.cards.listOwned(actor);
    return Object.freeze({ cards: Object.freeze(cards.map(projectMyCard)) });
  }

  async listMySelectableCards(): Promise<readonly MyCardSummaryView[]> {
    return (await this.getMyCards()).cards;
  }

  async createMyCard(input: Readonly<{
    name: string;
    type: Card["type"];
    colorId: CardColorId;
    commandId?: CommandId;
  }>): Promise<MyCardSummaryView> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId = input.commandId ?? commandId(this.deps.values.nextId("command"));
    const idempotency: IdempotencyDescriptor = { actorId: actor, commandType: "create-card", commandId: activeCommandId, intentDigest: canonicalIntentDigest({ name: input.name.trim(), type: input.type, colorId: input.colorId }) };
    const replay = await this.deps.repositories.commandOutcomes.get(idempotency);
    if (replay) {
      assertIdempotentIntent(replay, idempotency);
      const replayed = await this.deps.repositories.cards.getOwned(cardId(replay.resourceId), actor);
      if (!replayed) throw new ApplicationError("NOT_FOUND", "Card not found.");
      return projectMyCard(replayed);
    }
    const now = this.deps.values.now();
    const card: Card = {
      cardId: cardId(this.deps.values.nextId("card")),
      ownerId: actor,
      name: input.name.trim(),
      type: input.type,
      colorId: input.colorId,
      createdAt: now,
      updatedAt: now,
    };
    assertCard(card);
    const resourceId = await this.deps.atomic.createCard({ card, idempotency });
    const committed = await this.deps.repositories.cards.getOwned(cardId(resourceId), actor);
    if (!committed) throw new ApplicationError("NOT_FOUND", "Card not found.");
    return projectMyCard(committed);
  }

  async updateMyCard(id: CardId, input: Readonly<{
    name: string;
    type: Card["type"];
    colorId: CardColorId;
    commandId?: CommandId;
  }>): Promise<MyCardSummaryView> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId = input.commandId ?? commandId(this.deps.values.nextId("command"));
    const delivery: IdempotencyDescriptor = { actorId: actor, commandType: "edit-card", commandId: activeCommandId, intentDigest: canonicalIntentDigest({ cardId: id, name: input.name.trim(), type: input.type, colorId: input.colorId }) };
    const replay = await this.deps.repositories.commandOutcomes.get(delivery);
    if (replay) {
      assertIdempotentIntent(replay, delivery);
      const replayed = await this.deps.repositories.cards.getOwned(cardId(replay.resourceId), actor);
      if (!replayed) throw new ApplicationError("NOT_FOUND", "Card not found.");
      return projectMyCard(replayed);
    }
    const current = await this.deps.repositories.cards.getOwned(id, actor);
    if (!current || current.archivedAt) throw new ApplicationError("NOT_FOUND", "Card not found.");
    const updated: Card = {
      ...current,
      name: input.name.trim(),
      type: input.type,
      colorId: input.colorId,
      updatedAt: this.deps.values.now(),
    };
    assertCard(updated);
    await this.deps.atomic.updateCard({ card: updated, expectedUpdatedAt: current.updatedAt });
    return projectMyCard(updated);
  }

  async getMyCardRemovalPreview(id: CardId): Promise<CardRemovalPreview> {
    const actor = await this.deps.session.getCurrentUserId();
    const [card, action] = await Promise.all([
      this.deps.repositories.cards.getOwned(id, actor),
      this.deps.repositories.cards.getOwnedRemovalAction(id, actor),
    ]);
    if (!card || card.archivedAt || !action) throw new ApplicationError("NOT_FOUND", "Card not found.");
    return buildCardRemovalPreview(card, action);
  }

  async deleteOrArchiveMyCard(
    id: CardId,
    expectedAction: CardRemovalAction,
    requestedCommandId?: CommandId,
  ): Promise<CardRemovalResult> {
    const actor = await this.deps.session.getCurrentUserId();
    const activeCommandId = requestedCommandId ?? commandId(this.deps.values.nextId("command"));
    const delivery: IdempotencyDescriptor = { actorId: actor, commandType: "remove-card", commandId: activeCommandId, intentDigest: canonicalIntentDigest({ cardId: id, expectedAction }) };
    const replay = await this.deps.repositories.commandOutcomes.get(delivery);
    if (replay) {
      assertIdempotentIntent(replay, delivery);
      const [action, resourceId] = replay.resourceId.split(":", 2);
      if (resourceId !== id || (action !== "delete" && action !== "archive")) throw new ApplicationError("NOT_FOUND", "Card not found.");
      return action === "delete" ? "deleted" : "archived";
    }
    return this.deps.atomic.removeCard({
      cardId: id,
      ownerId: actor,
      expectedAction,
      occurredAt: this.deps.values.now(),
    });
  }
}
