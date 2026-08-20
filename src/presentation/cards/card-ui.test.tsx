import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  CardPageView,
  CardRemovalPreview,
} from "@/application/cards/card-page";
import { cardId, userId } from "@/domain/shared/identifiers";
import {
  ApplicationRuntimeProvider,
  type ApplicationRuntimeState,
  type CardApplicationActions,
} from "@/presentation/runtime/application-runtime-context";
import { CardsPageClient } from "./cards-page.client";

const alice = userId("cards-ui-alice");
const bob = userId("cards-ui-bob");
const salaryCard = {
  cardId: cardId("salary-card"),
  name: "Salary Card",
  type: "debit" as const,
  colorId: "mint" as const,
};

function runtimeFor(
  ownerId = alice,
  overrides: Partial<CardApplicationActions> = {},
): ApplicationRuntimeState {
  return {
    status: "ready",
    session: {
      userId: ownerId,
      displayName: ownerId === alice ? "Alice" : "Bob",
      displayEmail: `${ownerId}@example.test`,
      roleLabel: "No active household",
      settlementActionCount: 0,
    },
    household: { status: "no-household" },
    householdActions: {
      generateCode: vi.fn(), createHousehold: vi.fn(), findHousehold: vi.fn(),
      requestToJoin: vi.fn(), cancelJoinRequest: vi.fn(), acceptJoinRequest: vi.fn(),
      rejectJoinRequest: vi.fn(), leaveHousehold: vi.fn(), removeMember: vi.fn(),
      transferLeadership: vi.fn(), deleteHousehold: vi.fn(), refresh: vi.fn(),
    },
    expenseActions: {
      listExpenses: vi.fn(), listMembers: vi.fn(), listSelectableCards: vi.fn(),
      getExpense: vi.fn(), createExpense: vi.fn(), editExpense: vi.fn(), deleteExpense: vi.fn(),
      listReceipts: vi.fn(), readReceipt: vi.fn(), deleteReceipt: vi.fn(), listActivity: vi.fn(),
    },
    settlementActions: {
      getPage: vi.fn(), getPendingPreview: vi.fn(), markRecommendationPaid: vi.fn(),
      confirm: vi.fn(), reject: vi.fn(), cancel: vi.fn(),
    },
    cardActions: {
      getMyCards: vi.fn().mockResolvedValue({ cards: [] } satisfies CardPageView),
      createMyCard: vi.fn(), updateMyCard: vi.fn(), getRemovalPreview: vi.fn(),
      deleteOrArchive: vi.fn(),
      ...overrides,
    },
    analyticsActions: {
      getDashboard: vi.fn(),
      getMonthlyReport: vi.fn(),
    },
  };
}

function renderPage(runtime: ApplicationRuntimeState) {
  return render(
    <ApplicationRuntimeProvider value={runtime}>
      <CardsPageClient />
    </ApplicationRuntimeProvider>,
  );
}

describe("Phase 9 Cards presentation", () => {
  it("shows the no-Household empty state and an accessible form with every approved palette choice", async () => {
    const user = userEvent.setup();
    const createMyCard = vi.fn().mockResolvedValue({
      cardId: cardId("created-card"), name: "Travel", type: "credit", colorId: "soft-coral",
    });
    renderPage(runtimeFor(alice, { createMyCard }));

    expect(await screen.findByText("No cards yet")).toBeInTheDocument();
    expect(screen.getByText(/create a private card label/i)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Add Card" })[0]!);
    const dialog = screen.getByRole("dialog", { name: "Add Card" });
    await waitFor(() => expect(within(dialog).getByRole("textbox", { name: "Card Name" })).toHaveFocus());
    for (const name of ["Mint", "Powder Blue", "Lavender", "Warm Sand", "Soft Coral", "Charcoal"]) {
      expect(within(dialog).getByRole("radio", { name })).toBeInTheDocument();
    }

    await user.click(within(dialog).getByRole("button", { name: "Add Card" }));
    expect(await within(dialog).findByText("Card Name is required.")).toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Card Name" }), "  Travel  ");
    await user.click(within(dialog).getByRole("radio", { name: "Credit" }));
    await user.click(within(dialog).getByRole("radio", { name: "Soft Coral" }));
    await user.click(within(dialog).getByRole("button", { name: "Add Card" }));
    await waitFor(() => expect(createMyCard).toHaveBeenCalledWith({
      name: "Travel", type: "credit", colorId: "soft-coral",
    }));
  });

  it("supports keyboard menus, edit values, distinct removal copy, and focus return", async () => {
    const user = userEvent.setup();
    const preview: CardRemovalPreview = {
      cardId: salaryCard.cardId,
      name: salaryCard.name,
      expectedAction: "delete",
      title: "Delete Salary Card?",
      description: "This card has never been used by an expense and will be permanently removed.",
    };
    renderPage(runtimeFor(alice, {
      getMyCards: vi.fn().mockResolvedValue({ cards: [salaryCard] }),
      getRemovalPreview: vi.fn().mockResolvedValue(preview),
    }));
    expect(await screen.findByText("Salary Card")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /actions for salary card/i });

    trigger.focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.getByRole("dialog", { name: "Edit Card" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Card Name" })).toHaveValue("Salary Card");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    const confirmation = await screen.findByRole("alertdialog");
    expect(within(confirmation).getByText("Delete Salary Card?")).toBeInTheDocument();
    expect(within(confirmation).getByText(/never been used by an expense/i)).toBeInTheDocument();
    expect(within(confirmation).getByRole("button", { name: "Delete Card" })).toBeInTheDocument();
    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("requires fresh Archive consent when a Delete preview becomes stale", async () => {
    const user = userEvent.setup();
    const deleted: CardRemovalPreview = {
      cardId: salaryCard.cardId,
      name: salaryCard.name,
      expectedAction: "delete",
      title: "Delete Salary Card?",
      description: "This card has never been used by an expense and will be permanently removed.",
    };
    const archived: CardRemovalPreview = {
      ...deleted,
      expectedAction: "archive",
      title: "Archive Salary Card?",
      description: "This card has been used by previous expenses. It will no longer be available for new expenses, but historical records will remain unchanged.",
    };
    const getRemovalPreview = vi.fn()
      .mockResolvedValueOnce(deleted)
      .mockResolvedValueOnce(archived);
    const deleteOrArchive = vi.fn().mockRejectedValueOnce(new Error("conflict"));
    renderPage(runtimeFor(alice, {
      getMyCards: vi.fn().mockResolvedValue({ cards: [salaryCard] }),
      getRemovalPreview,
      deleteOrArchive,
    }));
    await user.click(await screen.findByRole("button", { name: /actions for salary card/i }));
    await user.click(screen.getByRole("menuitem", { name: "Remove" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete Card" }));

    const refreshed = await screen.findByRole("alertdialog");
    expect(within(refreshed).getByText("Archive Salary Card?")).toBeInTheDocument();
    expect(within(refreshed).getByRole("alert")).toHaveTextContent(/review and confirm/i);
    expect(within(refreshed).getByRole("button", { name: "Archive Card" })).toBeInTheDocument();
    expect(deleteOrArchive).toHaveBeenCalledTimes(1);
  });

  it("clears the previous owner's private Card immediately during identity reconstruction", async () => {
    let resolveBob!: (view: CardPageView) => void;
    const bobCards = new Promise<CardPageView>((resolve) => { resolveBob = resolve; });
    const initial = runtimeFor(alice, {
      getMyCards: vi.fn().mockResolvedValue({ cards: [salaryCard] }),
    });
    const rendered = renderPage(initial);
    expect(await screen.findByText("Salary Card")).toBeInTheDocument();

    rendered.rerender(
      <ApplicationRuntimeProvider value={runtimeFor(bob, { getMyCards: vi.fn().mockReturnValue(bobCards) })}>
        <CardsPageClient />
      </ApplicationRuntimeProvider>,
    );
    expect(screen.queryByText("Salary Card")).not.toBeInTheDocument();
    expect(screen.getByText("Loading your private Cards")).toBeInTheDocument();
    resolveBob({ cards: [] });
    expect(await screen.findByText("No cards yet")).toBeInTheDocument();
  });
});
