import { FULL_LOCAL_CAPABILITIES } from "@/application/runtime-capabilities";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ExpenseApplicationActions,
  ApplicationRuntimeState,
} from "@/presentation/runtime/application-runtime-context";
import {
  ApplicationRuntimeProvider,
} from "@/presentation/runtime/application-runtime-context";
import type {
  ExpenseMemberView,
  ExpenseView,
  PrivateReceiptView,
} from "@/application/services/application-services";
import { deterministicSeedData, SEEDED_USER_IDS } from "@/infrastructure/indexeddb/seed";
import { receiptId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import { DomainError } from "@/domain/shared/domain-error";
import { ApplicationError, BackdatedExpenseConfirmationRequiredError } from "@/application/errors/application-error";
import { RECEIPT_RETENTION_NOTICE } from "./expense-ui";
import { ExpenseDetailsPageClient } from "./expense-details-page.client";
import { ExpenseFormPageClient } from "./expense-form-page.client";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const seed = deterministicSeedData();
const expense = seed.expenses[0]!;
const expenseView: ExpenseView = {
  expense: { ...expense, payment: { method: "cash" } },
  percentageSourceStatus: "not-applicable",
  permissions: {
    canEdit: true,
    canEditFinancialFields: true,
    canDelete: true,
  },
      financialEditability: { state: "editable", reasons: [] },
      addedAfterSettlement: false,
};
const financiallyLockedExpenseView: ExpenseView = {
  ...expenseView,
  permissions: {
    canEdit: true,
    canEditFinancialFields: false,
    canDelete: false,
  },
  financialEditability: {
    state: "locked",
    reasons: ["confirmed-settlement"],
    title: "Financial details are locked",
    description:
      "This expense existed before a household settlement was confirmed. Changing its financial details could alter balances that have already been settled.",
    deleteDescription:
      "This expense is part of settled financial history and can no longer be deleted.",
  },
};
const members: readonly ExpenseMemberView[] = seed.memberships.map((membership) => ({
  userId: membership.userId,
  displayName: seed.profiles.find((profile) => profile.userId === membership.userId)!.displayName,
  status: membership.status,
  role: membership.role,
}));

const receipts: readonly PrivateReceiptView[] = [
  {
    visibility: "private",
    receiptId: receiptId("receipt-ui-available"),
    originalFilename: "available.png",
    mimeType: "image/png",
    sizeBytes: seed.receiptBytes.byteLength,
    createdAt: isoInstant("2026-08-20T14:00:00.000Z"),
    contentStatus: "available",
    canRead: true,
    canRemove: true,
  },
  {
    visibility: "private",
    receiptId: receiptId("receipt-ui-expired"),
    originalFilename: "expired.png",
    mimeType: "image/png",
    sizeBytes: seed.receiptBytes.byteLength,
    createdAt: isoInstant("2026-05-20T14:00:00.000Z"),
    contentStatus: "retention-expired",
    canRead: false,
    canRemove: false,
  },
  {
    visibility: "private",
    receiptId: receiptId("receipt-ui-user-deleted"),
    originalFilename: "removed.png",
    mimeType: "image/png",
    sizeBytes: seed.receiptBytes.byteLength,
    createdAt: isoInstant("2026-08-19T14:00:00.000Z"),
    contentStatus: "user-deleted",
    canRead: false,
    canRemove: false,
  },
];

function expenseActions(overrides: Partial<ExpenseApplicationActions> = {}): ExpenseApplicationActions {
  return {
    getCurrentBusinessDate: vi.fn().mockResolvedValue(expense.expenseDate),
    getMyAvailableReceiptBytes: vi.fn().mockResolvedValue(0),
    listExpenses: vi.fn().mockResolvedValue([expenseView]),
    listMembers: vi.fn().mockResolvedValue(members),
    listSelectableCards: vi.fn().mockResolvedValue([]),
    getExpense: vi.fn().mockResolvedValue(expenseView),
    createExpense: vi.fn(),
    editExpense: vi.fn(),
    deleteExpense: vi.fn(),
    listReceipts: vi.fn().mockResolvedValue(receipts),
    readReceipt: vi.fn().mockResolvedValue({ bytes: seed.receiptBytes, mimeType: "image/png" }),
    deleteReceipt: vi.fn(),
    listActivity: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function readyState(actions: ExpenseApplicationActions): Extract<ApplicationRuntimeState, { status: "ready" }> {
  return {
    status: "ready",
      capabilities: FULL_LOCAL_CAPABILITIES,
    session: {
      userId: SEEDED_USER_IDS.raiyan,
      displayName: "Raiyan",
      displayEmail: "raiyan@example.test",
      roleLabel: "Leader",
      householdName: seed.household.name,
      settlementActionCount: 0,
    },
    household: {
      status: "active-leader",
      household: {
        householdId: seed.household.householdId,
        name: seed.household.name,
        code: seed.household.code,
      },
      page: {} as never,
      joinRequests: [],
    },
    householdActions: {} as never,
    expenseActions: actions,
    settlementActions: {} as never,
    cardActions: {} as never,
    analyticsActions: {} as never,
  };
}

function renderWithRuntime(ui: React.ReactNode, actions: ExpenseApplicationActions) {
  return render(
    <ApplicationRuntimeProvider value={readyState(actions)}>
      {ui}
    </ApplicationRuntimeProvider>,
  );
}

describe("receipt retention presentation", () => {
  beforeEach(() => {
    push.mockReset();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:available-receipt");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it("previews only available content and renders distinct terminal history on Details", async () => {
    const actions = expenseActions();
    renderWithRuntime(
      <ExpenseDetailsPageClient expenseId={expense.expenseId} />,
      actions,
    );

    expect(await screen.findByRole("heading", { name: expense.name })).toBeVisible();
    expect(screen.getByRole("img", { name: "available.png" })).toBeVisible();
    expect(screen.getByText("Receipt no longer available")).toBeVisible();
    expect(screen.getByText("Receipt removed")).toBeVisible();
    expect(screen.getAllByText(RECEIPT_RETENTION_NOTICE).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Preview unavailable")).not.toBeInTheDocument();
    await waitFor(() => expect(actions.readReceipt).toHaveBeenCalledTimes(1));
    expect(actions.readReceipt).toHaveBeenCalledWith(receipts[0]!.receiptId);
    expect(actions.readReceipt).not.toHaveBeenCalledWith(receipts[1]!.receiptId);
    expect(actions.readReceipt).not.toHaveBeenCalledWith(receipts[2]!.receiptId);
    expect(screen.queryByRole("button", { name: "Remove expired.png" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove removed.png" })).not.toBeInTheDocument();
  });

  it("shows the restrained retention notice before upload on Add", async () => {
    const actions = expenseActions({
      getMyAvailableReceiptBytes: vi.fn().mockResolvedValue(7 * 1024 * 1024),
    });
    renderWithRuntime(<ExpenseFormPageClient mode="create" />, actions);

    expect(await screen.findByRole("heading", { name: "Add Expense" })).toBeVisible();
    expect(screen.getByText(/43 MiB of your receipt quota remains/u)).toBeVisible();
    expect(screen.getAllByText(RECEIPT_RETENTION_NOTICE).length).toBeGreaterThanOrEqual(1);
    expect(actions.readReceipt).not.toHaveBeenCalled();
  });

  it("shows terminal receipts as read-only history on Edit without Blob reads", async () => {
    const terminalReceipts = receipts.slice(1);
    const actions = expenseActions({
      listReceipts: vi.fn().mockResolvedValue(terminalReceipts),
    });
    renderWithRuntime(
      <ExpenseFormPageClient mode="edit" expenseId={expense.expenseId} />,
      actions,
    );

    expect(await screen.findByRole("heading", { name: "Edit Expense" })).toBeVisible();
    expect(screen.getByText("Receipt no longer available")).toBeVisible();
    expect(screen.getByText("Receipt removed")).toBeVisible();
    expect(screen.getAllByText(RECEIPT_RETENTION_NOTICE).length).toBeGreaterThanOrEqual(1);
    expect(actions.readReceipt).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Remove$/u })).not.toBeInTheDocument();
  });

  it("disables only financial controls for a settled-history Expense", async () => {
    const actions = expenseActions({
      getExpense: vi.fn().mockResolvedValue(financiallyLockedExpenseView),
      listReceipts: vi.fn().mockResolvedValue([receipts[0]]),
    });
    renderWithRuntime(
      <ExpenseFormPageClient mode="edit" expenseId={expense.expenseId} />,
      actions,
    );

    expect(
      await screen.findByText("Financial details are locked"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "This expense existed before a household settlement was confirmed. Changing its financial details could alter balances that have already been settled.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Expense Name")).toBeEnabled();
    expect(screen.getByLabelText("Amount (BDT)")).toBeDisabled();
    expect(screen.getByLabelText("Expense Date")).toBeDisabled();
    expect(screen.getByRole("radio", { name: "cash" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "equal" })).toBeDisabled();
    for (const participant of screen.getAllByRole("checkbox")) {
      expect(participant).toBeDisabled();
    }
    expect(screen.getByText("Add receipt images").closest("label")).not.toHaveAttribute(
      "aria-disabled",
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  });

  it("reloads a stale Edit lock while preserving Name and receipt drafts", async () => {
    const user = userEvent.setup();
    const getExpense = vi
      .fn()
      .mockResolvedValueOnce(expenseView)
      .mockResolvedValueOnce(financiallyLockedExpenseView);
    const editExpense = vi.fn().mockRejectedValue(
      new DomainError(
        "EXPENSE_FINANCIAL_HISTORY_LOCKED",
        "Internal settled-history lock.",
      ),
    );
    const actions = expenseActions({
      getExpense,
      editExpense,
      listReceipts: vi.fn().mockResolvedValue([]),
    });
    renderWithRuntime(
      <ExpenseFormPageClient mode="edit" expenseId={expense.expenseId} />,
      actions,
    );

    const name = await screen.findByLabelText("Expense Name");
    const amount = screen.getByLabelText("Amount (BDT)");
    await user.clear(name);
    await user.type(name, "Preserved draft name");
    await user.clear(amount);
    await user.type(amount, "301");
    const fileInput = document.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!;
    await user.upload(
      fileInput,
      new File([seed.receiptBytes], "draft.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(
      await screen.findByText(/Financial details are now locked/u),
    ).toBeVisible();
    expect(screen.getByText("Financial details are locked")).toBeVisible();
    expect(name).toHaveValue("Preserved draft name");
    expect(amount).toHaveValue("300.00");
    expect(amount).toBeDisabled();
    expect(screen.getByText("draft.png")).toBeVisible();
    expect(screen.queryByText("EXPENSE_FINANCIAL_HISTORY_LOCKED")).not.toBeInTheDocument();
    expect(editExpense).toHaveBeenCalledTimes(1);
    expect(getExpense).toHaveBeenCalledTimes(2);
  });

  it("retains one command ID through authoritative backdated confirmation", async () => {
    const user = userEvent.setup();
    const editExpense = vi.fn()
      .mockRejectedValueOnce(new BackdatedExpenseConfirmationRequiredError("confirm-backdated"))
      .mockResolvedValueOnce(expenseView);
    renderWithRuntime(
      <ExpenseFormPageClient mode="edit" expenseId={expense.expenseId} />,
      expenseActions({ editExpense, listReceipts: vi.fn().mockResolvedValue([]) }),
    );
    await screen.findByLabelText("Expense Name");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/dated before a household settlement/i);
    const firstCommand = editExpense.mock.calls[0]![0];
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(editExpense).toHaveBeenCalledTimes(2));
    expect(editExpense.mock.calls[1]![0]).toMatchObject({ commandId: firstCommand.commandId, backdatedConfirmationToken: "confirm-backdated" });
  });

  it("reloads an OCC conflict and shows the stable review message", async () => {
    const user = userEvent.setup();
    const refreshed = { ...expenseView, expense: { ...expenseView.expense, revision: expenseView.expense.revision + 1, name: "Concurrent name" } };
    const getExpense = vi.fn().mockResolvedValueOnce(expenseView).mockResolvedValueOnce(refreshed);
    const editExpense = vi.fn().mockRejectedValue(new ApplicationError("EXPENSE_VERSION_CONFLICT", "conflict"));
    renderWithRuntime(<ExpenseFormPageClient mode="edit" expenseId={expense.expenseId} />, expenseActions({ getExpense, editExpense, listReceipts: vi.fn().mockResolvedValue([]) }));
    await screen.findByLabelText("Expense Name");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    expect(await screen.findByText("This expense changed while you were editing it. Refresh and review the latest version before saving.")).toBeVisible();
    expect(getExpense).toHaveBeenCalledTimes(2);
  });

  it("renders only a generic attachment for a non-private viewer", async () => {
    const actions = expenseActions({
      listReceipts: vi.fn().mockResolvedValue([{ visibility: "attachment", label: "Receipt attached" }]),
    });
    renderWithRuntime(<ExpenseDetailsPageClient expenseId={expense.expenseId} />, actions);
    expect(await screen.findByText("Receipt attached")).toBeVisible();
    expect(screen.queryByText(/groceries\.png|Uploaded/u)).not.toBeInTheDocument();
    expect(actions.readReceipt).not.toHaveBeenCalled();
  });

  it("refreshes stale Delete capability and removes the actionable operation", async () => {
    const user = userEvent.setup();
    const getExpense = vi
      .fn()
      .mockResolvedValueOnce(expenseView)
      .mockResolvedValueOnce(financiallyLockedExpenseView);
    const deleteExpense = vi.fn().mockRejectedValue(
      new DomainError(
        "EXPENSE_FINANCIAL_HISTORY_LOCKED",
        "Internal settled-history lock.",
      ),
    );
    const actions = expenseActions({ getExpense, deleteExpense });
    renderWithRuntime(
      <ExpenseDetailsPageClient expenseId={expense.expenseId} />,
      actions,
    );

    await screen.findByRole("heading", { name: expense.name });
    await user.click(screen.getByRole("button", { name: "More expense actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete Expense" }));
    await user.click(screen.getByRole("button", { name: "Delete Expense" }));

    expect(
      await screen.findByText(
        "This expense is part of settled financial history and can no longer be deleted.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Financial details are locked")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "More expense actions" }),
    ).not.toBeInTheDocument();
    expect(deleteExpense).toHaveBeenCalledTimes(1);
    expect(getExpense).toHaveBeenCalledTimes(2);
    expect(push).not.toHaveBeenCalled();
  });
});
