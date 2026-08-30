import { FULL_LOCAL_CAPABILITIES } from "@/application/runtime-capabilities";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { userId } from "@/domain/shared/identifiers";
import {
  ApplicationRuntimeProvider,
  type ApplicationRuntimeState,
} from "@/presentation/runtime/application-runtime-context";
import { ProfilePageClient } from "./profile-page.client";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

function readyRuntime(
  session: Extract<ApplicationRuntimeState, { status: "ready" }>["session"],
  production = false,
): ApplicationRuntimeState {
  return {
    status: "ready",
      capabilities: FULL_LOCAL_CAPABILITIES,
    session,
    household: { status: "no-household" },
    householdActions: {
      generateCode: vi.fn(), createHousehold: vi.fn(), findHousehold: vi.fn(),
      requestToJoin: vi.fn(), cancelJoinRequest: vi.fn(), acceptJoinRequest: vi.fn(),
      rejectJoinRequest: vi.fn(), leaveHousehold: vi.fn(), renameHousehold: vi.fn(), removeMember: vi.fn(),
      transferLeadership: vi.fn(), deleteHousehold: vi.fn(), refresh: vi.fn(),
    },
    expenseActions: {
      getCurrentBusinessDate: vi.fn(),
      getMyAvailableReceiptBytes: vi.fn(),
      listExpenses: vi.fn(), listMembers: vi.fn(), listSelectableCards: vi.fn(),
      getExpense: vi.fn(), createExpense: vi.fn(), editExpense: vi.fn(), deleteExpense: vi.fn(),
      listReceipts: vi.fn(), readReceipt: vi.fn(), deleteReceipt: vi.fn(), listActivity: vi.fn(),
    },
    settlementActions: {
      getPage: vi.fn(), getPendingPreview: vi.fn(), markRecommendationPaid: vi.fn(),
      confirm: vi.fn(), reject: vi.fn(), cancel: vi.fn(),
    },
    cardActions: {
      getMyCards: vi.fn(), createMyCard: vi.fn(), updateMyCard: vi.fn(),
      getRemovalPreview: vi.fn(), deleteOrArchive: vi.fn(),
    },
    analyticsActions: { getDashboard: vi.fn(), getMonthlyReport: vi.fn() },
    ...(production ? { signOut: vi.fn() } : {}),
  };
}

function renderPage(runtime: ApplicationRuntimeState) {
  return render(
    <ApplicationRuntimeProvider value={runtime}>
      <ProfilePageClient />
    </ApplicationRuntimeProvider>,
  );
}

describe("Profile presentation", () => {
  beforeEach(() => {
    navigation.replace.mockReset();
    navigation.refresh.mockReset();
    vi.unstubAllGlobals();
  });

  it("renders existing local profile and active Household data read-only", () => {
    renderPage(readyRuntime({
      userId: userId("profile-raiyan"),
      displayName: "Raiyan Ahmed",
      displayEmail: "raiyan@example.test",
      roleLabel: "Leader",
      householdName: "Lake View House",
      settlementActionCount: 0,
    }));

    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Raiyan Ahmed" })).toBeInTheDocument();
    expect(screen.getAllByText("raiyan@example.test")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Lake View House" })).toBeInTheDocument();
    expect(screen.getByText("Leader")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Password" })).not.toBeInTheDocument();
    expect(screen.queryByText(/foundation ready/i)).not.toBeInTheDocument();
  });

  it("shows No household without inventing membership data", () => {
    renderPage(readyRuntime({
      userId: userId("profile-alex"),
      displayName: "Alex",
      displayEmail: "alex@example.test",
      roleLabel: "No active household",
      settlementActionCount: 0,
    }));

    expect(screen.getByRole("heading", { name: "No household" })).toBeInTheDocument();
    expect(screen.getByText("No household", { selector: "p" })).toBeInTheDocument();
  });

  it("exposes stable loading and error states", () => {
    const { rerender } = renderPage({ status: "loading" });
    expect(screen.getByRole("status")).toHaveTextContent("Loading profile");

    rerender(
      <ApplicationRuntimeProvider value={{ status: "error", message: "Local profile could not be loaded.", retry: vi.fn() }}>
        <ProfilePageClient />
      </ApplicationRuntimeProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Local profile could not be loaded.");
  });

  it("shows the password section only for an authenticated production session", () => {
    renderPage(readyRuntime({
      userId: userId("profile-raiyan"), displayName: "Raiyan", displayEmail: "raiyan@test.io",
      roleLabel: "Leader", householdName: "Lake View House", settlementActionCount: 0,
    }, true));
    expect(screen.getByRole("heading", { name: "Password" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("New Password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Confirm New Password")).toHaveAttribute("type", "password");
  });

  it("validates password confirmation without sending secrets and redirects to Login after success", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ updated: true }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", request);
    const user = userEvent.setup();
    renderPage(readyRuntime({
      userId: userId("profile-raiyan"), displayName: "Raiyan", displayEmail: "raiyan@test.io",
      roleLabel: "Leader", householdName: "Lake View House", settlementActionCount: 0,
    }, true));
    await user.type(screen.getByLabelText("Current Password"), "old-password");
    await user.type(screen.getByLabelText("New Password"), "new-password");
    await user.type(screen.getByLabelText("Confirm New Password"), "different-password");
    await user.click(screen.getByRole("button", { name: "Update Password" }));
    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Confirm New Password"));
    await user.type(screen.getByLabelText("Confirm New Password"), "new-password");
    await user.click(screen.getByRole("button", { name: "Update Password" }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login?passwordUpdated=1"));
    const sent = JSON.parse(String((request.mock.calls[0]?.[1] as RequestInit | undefined)?.body));
    expect(sent).toEqual({ currentPassword: "old-password", newPassword: "new-password", confirmPassword: "new-password" });
  });
});
