import { FULL_LOCAL_CAPABILITIES } from "@/application/runtime-capabilities";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { householdId, joinRequestId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import type { ActiveHouseholdPageView } from "@/application/household/household-page";
import {
  ApplicationRuntimeProvider,
  type ApplicationRuntimeState,
  type ExpenseApplicationActions,
  type HouseholdApplicationActions,
  type SettlementApplicationActions,
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
    leaveHousehold: vi.fn().mockResolvedValue(undefined),
    renameHousehold: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
    transferLeadership: vi.fn().mockResolvedValue(undefined),
    deleteHousehold: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function expenseActions(): ExpenseApplicationActions {
  return {
    getCurrentBusinessDate: vi.fn(),
    getMyAvailableReceiptBytes: vi.fn(),
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

function settlementActions(): SettlementApplicationActions {
  return {
    getPage: vi.fn(),
    getPendingPreview: vi.fn(),
    markRecommendationPaid: vi.fn(),
    confirm: vi.fn(),
    reject: vi.fn(),
    cancel: vi.fn(),
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
      capabilities: FULL_LOCAL_CAPABILITIES,
    session: {
      userId: userId("user-alex"),
      displayName: "Alex",
      displayEmail: "alex@local.test",
      profileVersion: 1,
      roleLabel: isLeader ? "Leader" : isMember ? "Member" : "No active household",
      settlementActionCount: 0,
      ...(isLeader || isMember ? { householdName: household.household.name } : {}),
    },
    household,
    householdActions,
    expenseActions: expenseActions(),
    settlementActions: settlementActions(),
    cardActions: {
      getMyCards: vi.fn(), createMyCard: vi.fn(), updateMyCard: vi.fn(),
      getRemovalPreview: vi.fn(), deleteOrArchive: vi.fn(),
    },
    profileActions: { updateDisplayName: vi.fn() },
    analyticsActions: {
      getDashboard: vi.fn(),
      getMonthlyReport: vi.fn(),
    },
  };
}

function renderRuntime(ui: React.ReactNode, state: ApplicationRuntimeState) {
  return render(<ApplicationRuntimeProvider value={state}>{ui}</ApplicationRuntimeProvider>);
}

function activePage(
  role: "leader" | "member",
  code = "012345678",
  house = householdId("household-main"),
): ActiveHouseholdPageView {
  const alex = userId("user-alex");
  const leader = role === "leader" ? alex : userId("user-leader");
  const leaderView = {
    memberId: leader,
    displayName: role === "leader" ? "Alex" : "Raiyan",
    role: "leader" as const,
    roleLabel: "Leader" as const,
    isCurrentUser: role === "leader",
  };
  const members = role === "leader"
    ? [
        leaderView,
        { memberId: userId("member-a"), displayName: "A duplicate member name that wraps safely across narrow screens", role: "member" as const, roleLabel: "Member" as const, isCurrentUser: false, remove: { eligible: true, blockers: [] } },
        { memberId: userId("member-b"), displayName: "A duplicate member name that wraps safely across narrow screens", role: "member" as const, roleLabel: "Member" as const, isCurrentUser: false, remove: { eligible: false, blockers: [{ code: "TARGET_OWES_BALANCE" as const }] } },
      ]
    : [
        leaderView,
        { memberId: alex, displayName: "Alex", role: "member" as const, roleLabel: "Member" as const, isCurrentUser: true },
      ];
  const base = {
    household: { householdId: house, name: "Raiyan House", code },
    viewer: { memberId: alex, role },
    leader: leaderView,
    members,
    leave: role === "leader"
      ? { eligible: false, blockers: [{ code: "LEADERSHIP_TRANSFER_REQUIRED" as const }] }
      : { eligible: true, blockers: [] },
  };
  return role === "leader"
    ? { ...base, viewerRole: "leader", deleteHousehold: { eligible: true, blockers: [] } }
    : { ...base, viewerRole: "member" };
}

function activeState(
  role: "leader" | "member",
  householdActions = actions(),
  code = "012345678",
  house = householdId("household-main"),
) {
  const page = activePage(role, code, house);
  return readyState(
    role === "leader"
      ? {
          status: "active-leader",
          household: page.household,
          page,
          joinRequests: [{ joinRequestId: joinRequestId("pending-ui"), requesterName: "Sam", createdAt: isoInstant("2026-08-19T00:00:00.000Z") }],
        }
      : { status: "active-member", household: page.household, page },
    householdActions,
  );
}

describe("Phase 6 household presentation", () => {
  beforeEach(() => {
    replace.mockReset();
  });

  it("keeps household access requirements limited to the approved routes", () => {
    expect(routeRequiresHousehold("/dashboard")).toBe(true);
    expect(routeRequiresHousehold("/reports/monthly")).toBe(true);
    expect(routeRequiresHousehold("/expenses/new")).toBe(true);
    expect(routeRequiresHousehold("/settlements")).toBe(true);
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
    await waitFor(() => expect(create).toHaveBeenCalledWith("Alex House", "000000777", expect.any(String)));
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
    await waitFor(() => expect(request).toHaveBeenCalledWith(householdId("household-main"), expect.any(String)));
    expect(replace).toHaveBeenCalledWith("/household");
  });

  it("masks the exact House Code by default and supports Show, Hide, and leading-zero Copy", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderRuntime(<HouseholdPageClient />, activeState("member"));

    expect(screen.getByLabelText("House Code hidden")).toHaveTextContent("•••••••••");
    expect(screen.queryByText("012345678")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show House Code" }));
    expect(screen.getByLabelText("House Code 012345678")).toHaveTextContent("012345678");
    await user.click(screen.getByRole("button", { name: "Copy exact House Code" }));
    expect(writeText).toHaveBeenCalledWith("012345678");
    await user.click(screen.getByRole("button", { name: "Hide House Code" }));
    expect(screen.getByLabelText("House Code hidden")).toBeInTheDocument();
  });

  it("resets revealed code state when the Household or viewer identity changes", async () => {
    const user = userEvent.setup();
    const rendered = renderRuntime(<HouseholdPageClient />, activeState("member"));
    await user.click(screen.getByRole("button", { name: "Show House Code" }));
    expect(screen.getByLabelText("House Code 012345678")).toBeInTheDocument();

    rendered.rerender(
      <ApplicationRuntimeProvider value={activeState("member", actions(), "000000009", householdId("household-next"))}>
        <HouseholdPageClient />
      </ApplicationRuntimeProvider>,
    );
    expect(screen.getByLabelText("House Code hidden")).toHaveTextContent("•••••••••");

    await user.click(screen.getByRole("button", { name: "Show House Code" }));
    const identityChanged = activeState("member", actions(), "000000009", householdId("household-next"));
    const changedReady = identityChanged.status === "ready"
      ? { ...identityChanged, session: { ...identityChanged.session, userId: userId("different-viewer") } }
      : identityChanged;
    rendered.rerender(
      <ApplicationRuntimeProvider value={changedReady}>
        <HouseholdPageClient />
      </ApplicationRuntimeProvider>,
    );
    expect(screen.getByLabelText("House Code hidden")).toBeInTheDocument();
  });

  it("keeps Leader-only requests, member controls, and the danger zone absent for Members", () => {
    renderRuntime(<HouseholdPageClient />, activeState("member"));
    expect(screen.getByText("House Leader")).toBeInTheDocument();
    expect(screen.queryByText("Join requests")).not.toBeInTheDocument();
    expect(screen.queryByText("Danger zone")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manage/i })).not.toBeInTheDocument();
  });

  it("shows the active-only Leader view, deterministic duplicate labels, and accessible management dialogs", async () => {
    const user = userEvent.setup();
    const transferLeadership = vi.fn().mockResolvedValue(undefined);
    renderRuntime(
      <HouseholdPageClient />,
      activeState("leader", actions({ transferLeadership })),
    );

    expect(screen.getByText("Join requests")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("Danger zone")).toBeInTheDocument();
    const activeList = screen.getByRole("list", { name: "Active household members" });
    expect(within(activeList).getAllByText("A duplicate member name that wraps safely across narrow screens", { exact: true })).toHaveLength(2);
    const duplicateTriggers = screen.getAllByRole("button", { name: /manage a duplicate member name/i });
    expect(duplicateTriggers[0]).toHaveAccessibleName(/member 2 of 3/i);
    expect(duplicateTriggers[1]).toHaveAccessibleName(/member 3 of 3/i);
    const trigger = duplicateTriggers[0]!;
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("menuitem", { name: "Transfer Leadership" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/you will remain a normal household member/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("offers House name rename to the Leader only and commits a changed name", async () => {
    const user = userEvent.setup();
    const rename = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderRuntime(<HouseholdPageClient />, activeState("leader", actions({ renameHousehold: rename })));

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename Household" });
    expect(dialog).toBeVisible();
    expect(screen.getByLabelText("House name")).toHaveValue("Raiyan House");

    await user.clear(screen.getByLabelText("House name"));
    await user.click(screen.getByRole("button", { name: /Save Changes/ }));
    expect(await screen.findByText("The House name cannot be empty.")).toBeVisible();
    expect(rename).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("House name"), "Sunrise Villa");
    await user.click(screen.getByRole("button", { name: /Save Changes/ }));
    await waitFor(() => expect(rename).toHaveBeenCalledWith("Sunrise Villa"));
    unmount();

    renderRuntime(<HouseholdPageClient />, activeState("member"));
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Rename Household" })).toBeNull();
  });

  it("uses one deletion confirmation that promises preservation rather than erasure", async () => {
    const user = userEvent.setup();
    const deleteHousehold = vi.fn().mockResolvedValue(undefined);
    renderRuntime(<HouseholdPageClient />, activeState("leader", actions({ deleteHousehold })));
    await user.click(screen.getByRole("button", { name: "Delete Household" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete Raiyan House?" });
    expect(within(dialog).getByText(/historical financial records will be preserved/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/erased|deleted permanently/i)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete Household" }));
    await waitFor(() => expect(deleteHousehold).toHaveBeenCalledTimes(1));
  });
});
