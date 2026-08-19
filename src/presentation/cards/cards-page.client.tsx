"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { CreditCard, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type {
  CardPageView,
  CardRemovalPreview,
  MyCardSummaryView,
} from "@/application/cards/card-page";
import type { CardFormValues } from "@/application/validation/card-form.schema";
import { EmptyState, ErrorState, LoadingState } from "@/presentation/components/async-state";
import { Surface } from "@/presentation/components/surface";
import { PageContainer } from "@/presentation/shell/page-container";
import { PageHeader } from "@/presentation/shell/page-header";
import {
  useApplicationRuntime,
  type CardApplicationActions,
} from "@/presentation/runtime/application-runtime-context";
import type { UserId } from "@/domain/shared/identifiers";
import { CardActionsMenu } from "./card-actions-menu";
import { CardFormDialog } from "./card-form-dialog";
import { getCardPaletteOption } from "./card-palette";
import { RemoveCardDialog } from "./remove-card-dialog";

type CardsState =
  | Readonly<{ status: "loading"; ownerId: UserId }>
  | Readonly<{ status: "error"; ownerId: UserId }>
  | Readonly<{ status: "ready"; ownerId: UserId; page: CardPageView }>;

interface FormTarget {
  readonly card?: MyCardSummaryView;
  readonly restoreFocusRef: RefObject<HTMLElement | null>;
}

interface RemoveTarget {
  readonly preview: CardRemovalPreview;
  readonly restoreFocusRef: RefObject<HTMLElement | null>;
}

function CardTile({
  card,
  position,
  count,
  onEdit,
  onRemove,
}: Readonly<{
  card: MyCardSummaryView;
  position: number;
  count: number;
  onEdit: (card: MyCardSummaryView, trigger: RefObject<HTMLButtonElement | null>) => void;
  onRemove: (card: MyCardSummaryView, trigger: RefObject<HTMLButtonElement | null>) => void;
}>) {
  const palette = getCardPaletteOption(card.colorId);
  const lightForeground = palette.foreground === "light";

  return (
    <Surface
      className={lightForeground ? "min-h-52 text-white" : "min-h-52 text-foreground"}
      role="listitem"
      style={{ backgroundColor: palette.hex }}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="break-words text-h3">{card.name}</h2>
            <p className={lightForeground ? "mt-1 capitalize text-white/80" : "mt-1 capitalize text-text-secondary"}>
              {card.type}
            </p>
          </div>
          <CardActionsMenu
            card={card}
            count={count}
            onEdit={(trigger) => onEdit(card, trigger)}
            onRemove={(trigger) => onRemove(card, trigger)}
            position={position}
          />
        </div>
        <div className="mt-auto flex items-end justify-between gap-4 pt-10">
          <p className={lightForeground ? "text-sm text-white/80" : "text-sm text-text-secondary"}>
            Private to you
          </p>
          <p className={lightForeground ? "text-caption text-white/70" : "text-caption text-text-secondary"}>
            {palette.label}
          </p>
        </div>
      </div>
    </Surface>
  );
}

function OwnedCardsPage({
  ownerId,
  actions,
}: Readonly<{ ownerId: UserId; actions: CardApplicationActions }>) {
  const [cardsState, setCardsState] = useState<CardsState>({ status: "loading", ownerId });
  const [formTarget, setFormTarget] = useState<FormTarget>();
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget>();
  const requestRef = useRef(0);
  const headerAddRef = useRef<HTMLButtonElement>(null);
  const emptyAddRef = useRef<HTMLButtonElement>(null);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const page = await actions.getMyCards();
      if (request === requestRef.current) {
        setCardsState({ status: "ready", ownerId, page });
      }
    } catch {
      if (request === requestRef.current) {
        setCardsState({ status: "error", ownerId });
      }
    }
  }, [actions, ownerId]);

  useEffect(() => {
    const request = ++requestRef.current;
    actions.getMyCards().then(
      (page) => {
        if (request === requestRef.current) {
          setCardsState({ status: "ready", ownerId, page });
        }
      },
      () => {
        if (request === requestRef.current) {
          setCardsState({ status: "error", ownerId });
        }
      },
    );
    return () => {
      requestRef.current += 1;
    };
  }, [actions, ownerId]);

  async function saveCard(values: CardFormValues) {
    if (!formTarget) return;
    if (formTarget.card) await actions.updateMyCard(formTarget.card.cardId, values);
    else await actions.createMyCard(values);
    await reload();
    toast.success(formTarget.card ? "Card updated" : "Card added");
  }

  async function openRemoval(
    card: MyCardSummaryView,
    restoreFocusRef: RefObject<HTMLButtonElement | null>,
  ) {
    try {
      const preview = await actions.getRemovalPreview(card.cardId);
      setRemoveTarget({ preview, restoreFocusRef });
    } catch {
      toast.error("The Card could not be opened. Refresh and try again.");
    }
  }

  async function confirmRemoval(preview: CardRemovalPreview): Promise<"removed" | "refreshed"> {
    if (!removeTarget) throw new Error("Card actions unavailable.");
    try {
      const result = await actions.deleteOrArchive(preview.cardId, preview.expectedAction);
      await reload();
      toast.success(result === "deleted" ? "Card deleted" : "Card archived");
      return "removed";
    } catch (error) {
      const refreshed = await actions.getRemovalPreview(preview.cardId).catch(() => undefined);
      if (refreshed && refreshed.expectedAction !== preview.expectedAction) {
        setRemoveTarget({ ...removeTarget, preview: refreshed });
        return "refreshed";
      }
      throw error;
    }
  }

  function closeForm() {
    const target = formTarget;
    setFormTarget(undefined);
    requestAnimationFrame(() => target?.restoreFocusRef.current?.focus());
  }

  function closeRemoval() {
    const target = removeTarget;
    setRemoveTarget(undefined);
    requestAnimationFrame(() => target?.restoreFocusRef.current?.focus());
  }

  if (cardsState.status === "loading") {
    return (
      <PageContainer className="space-y-8">
        <PageHeader description="Private card labels are visible only to you." title="My Cards" />
        <LoadingState label="Loading your private Cards" />
      </PageContainer>
    );
  }

  if (cardsState.status === "error") {
    return (
      <PageContainer className="space-y-8">
        <PageHeader description="Private card labels are visible only to you." title="My Cards" />
        <ErrorState description="Your private Cards could not be read." onRetry={() => void reload()} title="Cards unavailable" />
      </PageContainer>
    );
  }

  const cards = cardsState.page.cards;
  const openAdd = (restoreFocusRef: RefObject<HTMLElement | null>) => setFormTarget({ restoreFocusRef });

  return (
    <PageContainer className="space-y-8">
      <PageHeader
        action={(
          <Button className="w-full sm:w-auto" onClick={() => openAdd(headerAddRef)} ref={headerAddRef}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            Add Card
          </Button>
        )}
        description="Private card labels are visible only to you. Never add card numbers or banking credentials."
        title="My Cards"
      />

      {cards.length === 0 ? (
        <EmptyState
          action={(
            <Button onClick={() => openAdd(emptyAddRef)} ref={emptyAddRef}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              Add Card
            </Button>
          )}
          description="Create a private card label to remember which real-world card you used."
          icon={CreditCard}
          title="No cards yet"
        />
      ) : (
        <div aria-label="Your active Cards" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" role="list">
          {cards.map((card, index) => (
            <CardTile
              card={card}
              count={cards.length}
              key={card.cardId}
              onEdit={(selected, trigger) => setFormTarget({ card: selected, restoreFocusRef: trigger })}
              onRemove={(selected, trigger) => void openRemoval(selected, trigger)}
              position={index + 1}
            />
          ))}
        </div>
      )}

      {formTarget ? (
        <CardFormDialog
          card={formTarget.card}
          onOpenChange={(open) => { if (!open) closeForm(); }}
          onSubmit={saveCard}
          open
          restoreFocusRef={formTarget.restoreFocusRef}
        />
      ) : null}
      <RemoveCardDialog
        key={removeTarget?.preview.cardId ?? "closed"}
        onConfirm={confirmRemoval}
        onOpenChange={(open) => { if (!open) closeRemoval(); }}
        preview={removeTarget?.preview}
        restoreFocusRef={removeTarget?.restoreFocusRef}
      />
    </PageContainer>
  );
}

export function CardsPageClient() {
  const runtime = useApplicationRuntime();

  if (runtime.status === "error") {
    return (
      <PageContainer>
        <ErrorState description={runtime.message} onRetry={runtime.retry} title="Your Cards could not be loaded" />
      </PageContainer>
    );
  }

  if (runtime.status !== "ready") {
    return (
      <PageContainer className="space-y-8">
        <PageHeader description="Private card labels are visible only to you." title="My Cards" />
        <LoadingState label="Loading your private Cards" />
      </PageContainer>
    );
  }

  return (
    <OwnedCardsPage
      actions={runtime.cardActions}
      key={runtime.session.userId}
      ownerId={runtime.session.userId}
    />
  );
}
