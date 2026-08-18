import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { householdId, joinRequestId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import {
  ApplicationRuntimeProvider,
  type ApplicationRuntimeState,
  type ExpenseApplicationActions,
  type HouseholdApplicationActions,
} from "@/presentation/runtime/application-runtime-context";
import { routeRequiresHousehold } from "@/presentation/runtime/household-access-gate.client";
import { CreateHouseholdForm } from "./create-household-form.client";
import { HouseholdPageClient } from "./household-page.client";
import { JoinHouseholdForm } from "./join-household-form.client";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/household",
}));

function actions(overrides: Partial<HouseholdApplicationActions> = {}): HouseholdApplicationActions {
  return {
    generateCode: vi.fn().mockResolvedValue("000000777"),
    createHousehold: vi.fn().mockResolvedValue(undefined),
    findHousehold: vi.fn().mockResolvedValue({ householdId: householdId("household-main"), name: "Raiyan House", code: "012345678" }),
    requestToJoin: vi.fn().mockResolvedValue(undefined),
    cancelJoinRequest: vi.fn().mockResolvedValue(undefined),
    acceptJoinRequest: vi.fn().mockResolvedValue(undefined),
    rejectJoinRequest: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function expenseActions(): ExpenseApplicationActions {
  return {
    listExpenses: vi.fn(),
    listMembers: vi.fn(),
    listSelectableCards: vi.fn(),
    getExpense: vi.fn(),
    createExpense: vi.fn(),
    editExpense: vi.fn(),
    deleteExpense: vi.fn(),
    listReceipts: vi.fn(),
    readReceipt: vi.fn(),
    deleteReceipt: vi.fn(),
    listActivity: vi.fn(),
  };
}

function readyState(
  household: Extract<ApplicationRuntimeState, { status: "ready" }>["household"],
  householdActions = actions(),
): Extract<ApplicationRuntimeState, { status: "ready" }> {
  const isLeader = household.status === "active-leader";
  const isMember = household.status === "active-member";
  return {
    status: "ready",
    session: {
      userId: userId("user-alex"),
      displayName: "Alex",
      displayEmail: "alex@local.test",
      roleLabel: isLeader ? "Leader" : isMember ? "Member" : "No active household",
      ...(isLeader || isMember ? { householdName: household.household.name } : {}),
    },
    household,
    householdActions,
    expenseActions: expenseActions(),
  };
}

function renderRuntime(ui: React.ReactNode, state: ApplicationRuntimeState) {
  return render(<ApplicationRuntimeProvider value={state}>{ui}</ApplicationRuntimeProvider>);
}

describe("Phase 6 household presentation", () => {
  beforeEach(() => {
    replace.mockReset();
  });

  it("keeps household access requirements limited to the approved routes", () => {
    expect(routeRequiresHousehold("/dashboard")).toBe(true);
    expect(routeRequiresHousehold("/expenses/new")).toBe(true);
    expect(routeRequiresHousehold("/settlements/history")).toBe(true);
    expect(routeRequiresHousehold("/household")).toBe(false);
    expect(routeRequiresHousehold("/profile")).toBe(false);
    expect(routeRequiresHousehold("/cards")).toBe(false);
  });

  it("renders the spacious no-household choices", () => {
    renderRuntime(<HouseholdPageClient />, readyState({ status: "no-household" }));
    expect(screen.getByRole("heading", { name: "Household" })).toBeVisible();
    expect(screen.getByText("You aren't part of a household yet.")).toBeVisible();
    expect(screen.getByRole("link", { name: /Create a Household/ })).toHaveAttribute("href", "/household/create");
    expect(screen.getByRole("link", { name: /Join a Household/ })).toHaveAttribute("href", "/household/join");
  });

  it("confirms and cancels a Pending request without displaying private household data", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn().mockResolvedValue(undefined);
    renderRuntime(
      <HouseholdPageClient />,
      readyState({
        status: "pending-request",
        request: {
          joinRequestId: joinRequestId("join-alex-main"),
          household: { householdId: householdId("household-main"), name: "Raiyan House", code: "012345678" },
          createdAt: isoInstant("2026-08-13T00:00:00.000Z"),
        },
      }, actions({ cancelJoinRequest: cancel })),
    );

    expect(screen.queryByText(/Groceries|John|Sarah|balance|expense/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel Request" }));
    const dialog = screen.getByRole("alertdialog", { name: "Cancel this join request?" });
    expect(dialog).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(joinRequestId("join-alex-main")));
  });

  it("validates, generates, and submits a trimmed household with its exact code", async () => {
    const user = userEvent.setup();
    const create = vi.fn().mockResolvedValue(undefined);
    const generate = vi.fn().mockResolvedValue("000000777");
    renderRuntime(<CreateHouseholdForm />, readyState({ status: "no-household" }, actions({ createHousehold: create, generateCode: generate })));

    await user.click(screen.getByRole("button", { name: "Create Household" }));
    expect(await screen.findByText("Enter a house name.")).toBeVisible();
    expect(screen.getByLabelText("House Name*")).toHaveFocus();

    await user.type(screen.getByLabelText("House Name*"), "  Alex House  ");
    await user.click(screen.getByRole("button", { name: "Generate Code" }));
    expect(screen.getByLabelText("House Code*")).toHaveValue("000000777");
    await user.click(screen.getByRole("button", { name: "Create Household" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("Alex House", "000000777"));
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("finds only the minimal household identity and submits the opaque ID", async () => {
    const user = userEvent.setup();
    const find = vi.fn().mockResolvedValue({ householdId: householdId("household-main"), name: "Raiyan House", code: "012345678" });
    const request = vi.fn().mockResolvedValue(undefined);
    renderRuntime(<JoinHouseholdForm />, readyState({ status: "no-household" }, actions({ findHousehold: find, requestToJoin: request })));

    await user.type(screen.getByLabelText("House Code*"), "012345678");
    await user.click(screen.getByRole("button", { name: "Find Household" }));
    expect(await screen.findByText("Raiyan House")).toBeVisible();
    expect(screen.queryByText(/Raiyan.*Leader|John|Sarah|Groceries/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send Join Request" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(householdId("household-main")));
    expect(replace).toHaveBeenCalledWith("/household");
  });
});
