import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  PendingSettlementView,
  SettlementPageView,
} from "@/application/settlements/settlement-page";
import { poisha, positivePoisha } from "@/domain/money/poisha";
import {
  householdId,
  settlementId,
  userId,
} from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import {
  ApplicationRuntimeProvider,
  type ApplicationRuntimeState,
  type SettlementApplicationActions,
} from "@/presentation/runtime/application-runtime-context";
import { SettlementsPageClient } from "./settlements-page.client";

const household = householdId("house-settlements-ui");
const alice = userId("alice");
const bob = userId("bob");
const createdAt = isoInstant("2026-08-18T10:00:00.000Z");
const resolvedAt = isoInstant("2026-08-18T11:00:00.000Z");

const pending: PendingSettlementView = {
  settlementId: settlementId("pending-bob-alice"),
  amount: positivePoisha(80000),
  createdAt,
  sender: { userId: bob, displayName: "Bob", former: false },
  receiver: { userId: alice, displayName: "Alice", former: false },
  relationship: "receiver",
  allowedActions: { confirm: true, reject: true, cancel: false },
  warning: {
    heading: "Your household balance has changed",
    detail: "Confirming will still record the original payment amount.",
  },
};

const view: SettlementPageView = {
  householdId: household,
  currentUserId: alice,
  summary: { youOwe: poisha(125000), youAreOwed: poisha(0), settled: false },
  recommendations: [{
    recommendation: {
      householdId: household,
      senderId: alice,
      receiverId: bob,
      amount: positivePoisha(125000),
    },
    direction: "outgoing",
    counterparty: { userId: bob, displayName: "Bob", former: false },
    canMarkPaid: true,
  }],
  pending: [pending],
  history: [{
    settlementId: settlementId("history-confirmed"),
    amount: positivePoisha(90000),
    status: "confirmed",
    createdAt,
    resolvedAt,
    sender: { userId: bob, displayName: "Bob", former: false },
    receiver: { userId: alice, displayName: "Alice", former: false },
  }],
  actionablePendingCount: 1,
};

function renderPage(overrides: Partial<SettlementApplicationActions> = {}) {
  const settlementActions: SettlementApplicationActions = {
    getPage: vi.fn().mockResolvedValue(view),
    getPendingPreview: vi.fn().mockResolvedValue(pending),
    markRecommendationPaid: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(undefined),
    reject: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const runtime: ApplicationRuntimeState = {
    status: "ready",
    session: {
      userId: alice,
      displayName: "Alice",
      displayEmail: "alice@example.test",
      roleLabel: "Member",
      householdName: "Test House",
      settlementActionCount: 1,
    },
    household: {
      status: "active-member",
      household: { householdId: household, name: "Test House", code: "123456789" },
    },
    householdActions: {
      generateCode: vi.fn(), createHousehold: vi.fn(), findHousehold: vi.fn(),
      requestToJoin: vi.fn(), cancelJoinRequest: vi.fn(), acceptJoinRequest: vi.fn(),
      rejectJoinRequest: vi.fn(), refresh: vi.fn(),
    },
    expenseActions: {
      listExpenses: vi.fn(), listMembers: vi.fn(), listSelectableCards: vi.fn(),
      getExpense: vi.fn(), createExpense: vi.fn(), editExpense: vi.fn(), deleteExpense: vi.fn(),
      listReceipts: vi.fn(), readReceipt: vi.fn(), deleteReceipt: vi.fn(), listActivity: vi.fn(),
    },
    settlementActions,
    cardActions: {
      getMyCards: vi.fn(), createMyCard: vi.fn(), updateMyCard: vi.fn(),
      getRemovalPreview: vi.fn(), deleteOrArchive: vi.fn(),
    },
  };
  render(<ApplicationRuntimeProvider value={runtime}><SettlementsPageClient /></ApplicationRuntimeProvider>);
  return settlementActions;
}

describe("Phase 8 settlement presentation", () => {
  it("renders both net-position summaries, actor-specific recommendations, Pending, and terminal History", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Settlements" })).toBeInTheDocument();
    expect(screen.getByText("You Owe")).toBeInTheDocument();
    expect(screen.getByText("You Are Owed")).toBeInTheDocument();
    expect(screen.getByText("You owe Bob")).toBeInTheDocument();
    expect(screen.getByText("Bob says they paid you")).toBeInTheDocument();
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("discloses that Settle Up does not transfer money and submits the exact projected recommendation", async () => {
    const user = userEvent.setup();
    const actions = renderPage();
    const trigger = await screen.findByRole("button", { name: /settle up with bob/i });
    await user.click(trigger);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/does not transfer money/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Mark as Paid" }));
    await waitFor(() => expect(actions.markRecommendationPaid).toHaveBeenCalledWith(view.recommendations[0]!.recommendation));
  });

  it("refreshes stale confirmation data before allowing the receiver to confirm", async () => {
    const user = userEvent.setup();
    const actions = renderPage();
    await user.click(await screen.findByRole("button", { name: /confirm receipt of payment from bob/i }));
    const dialog = screen.getByRole("alertdialog");
    expect(await within(dialog).findByText(/household balance has changed/i)).toBeInTheDocument();
    await waitFor(() => expect(actions.getPendingPreview).toHaveBeenCalledWith(pending.settlementId));
    await user.click(within(dialog).getByRole("button", { name: "Confirm Received" }));
    await waitFor(() => expect(actions.confirm).toHaveBeenCalledWith(pending.settlementId));
  });

  it("returns focus to the Settle Up trigger when its confirmation is cancelled", async () => {
    const user = userEvent.setup();
    renderPage();
    const trigger = await screen.findByRole("button", { name: /settle up with bob/i });
    await user.click(trigger);
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
