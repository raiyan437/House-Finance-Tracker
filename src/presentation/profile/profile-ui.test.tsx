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
    capabilities: production ? { ...FULL_LOCAL_CAPABILITIES, avatarContentReads: true, avatarMutations: true } : FULL_LOCAL_CAPABILITIES,
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
    profileActions: { updateDisplayName: vi.fn(), replaceAvatar: vi.fn() },
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

  it("renders existing local profile, fixed email, and editable Display Name", () => {
    renderPage(readyRuntime({
      userId: userId("profile-raiyan"),
      displayName: "Raiyan Ahmed",
      displayEmail: "raiyan@example.test",
      profileVersion: 1,
      roleLabel: "Leader",
      householdName: "Lake View House",
      settlementActionCount: 0,
    }));

    expect(screen.getByRole("heading", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Raiyan Ahmed" })).toBeInTheDocument();
    expect(screen.getAllByText("raiyan@example.test")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Lake View House" })).toBeInTheDocument();
    expect(screen.getByText("Leader")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Display Name" })).toHaveValue("Raiyan Ahmed");
    expect(screen.getByRole("textbox", { name: "Display Name" })).toHaveAttribute("maxlength", "20");
    expect(screen.getByRole("button", { name: "Save Display Name" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Password" })).not.toBeInTheDocument();
    expect(screen.queryByText(/foundation ready/i)).not.toBeInTheDocument();
  });

  it("shows No household without inventing membership data", () => {
    renderPage(readyRuntime({
      userId: userId("profile-alex"),
      displayName: "Alex",
      displayEmail: "alex@example.test",
      profileVersion: 1,
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

  it("trims, validates, keyboard-submits, and reports Display Name saves accessibly", async () => {
    const user = userEvent.setup();
    const runtime = readyRuntime({
      userId: userId("profile-raiyan"), displayName: "Raiyan", displayEmail: "raiyan@test.io", profileVersion: 3,
      roleLabel: "Leader", householdName: "Lake View House", settlementActionCount: 0,
    });
    const update = vi.mocked((runtime as Extract<ApplicationRuntimeState, { status: "ready" }>).profileActions.updateDisplayName);
    update.mockResolvedValue(undefined);
    renderPage(runtime);
    const input = screen.getByRole("textbox", { name: "Display Name" });
    await user.clear(input);
    await user.type(input, "   ");
    await user.click(screen.getByRole("button", { name: "Save Display Name" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Display Name is required.");
    expect(input).toHaveFocus();
    expect(update).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "  Raiyan Updated  {Enter}");
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]?.[0]).toBe("Raiyan Updated");
    expect(update.mock.calls[0]?.[1]).toBe(3);
    expect(update.mock.calls[0]?.[2]).toEqual(expect.any(String));
    expect(await screen.findByRole("status")).toHaveTextContent("Display Name updated successfully.");
  });

  it("accepts 1 and 20 trimmed characters and rejects longer Display Names", async () => {
    const user = userEvent.setup();
    const runtime = readyRuntime({
      userId: userId("profile-raiyan"), displayName: "Raiyan", displayEmail: "raiyan@test.io", profileVersion: 3,
      roleLabel: "Leader", householdName: "Lake View House", settlementActionCount: 0,
    });
    const update = vi.mocked((runtime as Extract<ApplicationRuntimeState, { status: "ready" }>).profileActions.updateDisplayName);
    update.mockResolvedValue(undefined);
    renderPage(runtime);
    const input = screen.getByRole("textbox", { name: "Display Name" });

    await user.clear(input);
    await user.type(input, "A");
    await user.click(screen.getByRole("button", { name: "Save Display Name" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("A", 3, expect.any(String)));

    await user.clear(input);
    await user.type(input, "B".repeat(20));
    await user.click(screen.getByRole("button", { name: "Save Display Name" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith("B".repeat(20), 3, expect.any(String)));

    await user.clear(input);
    input.removeAttribute("maxlength");
    await user.type(input, "C".repeat(21));
    await user.click(screen.getByRole("button", { name: "Save Display Name" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Display name must be 20 characters or fewer.");
  });

  it("shows the password section only for an authenticated production session", () => {
    renderPage(readyRuntime({
      userId: userId("profile-raiyan"), displayName: "Raiyan", displayEmail: "raiyan@test.io",
      profileVersion: 1,
      roleLabel: "Leader", householdName: "Lake View House", settlementActionCount: 0,
    }, true));
    expect(screen.getByRole("heading", { name: "Password" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("New Password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Confirm New Password")).toHaveAttribute("type", "password");
  });

  it("validates, previews, replaces, and revokes Profile Picture object URLs", async () => {
    const createObjectURL = vi.fn()
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revokeObjectURL = vi.fn();
    const NativeURL = URL;
    class TestURL extends NativeURL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal("URL", TestURL);
    const user = userEvent.setup();
    const runtime = readyRuntime({
      userId: userId("profile-raiyan"), displayName: "Raiyan", displayEmail: "raiyan@test.io",
      profileVersion: 3, roleLabel: "Leader", householdName: "Lake View House", settlementActionCount: 0,
    }, true);
    const replace = vi.mocked((runtime as Extract<ApplicationRuntimeState, { status: "ready" }>).profileActions.replaceAvatar!);
    replace.mockResolvedValue(undefined);
    const view = renderPage(runtime);
    expect(screen.getByRole("heading", { name: "Profile Picture" })).toBeInTheDocument();
    const input = screen.getByLabelText("Profile picture file");

    await user.upload(input, new File([], "empty.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/valid JPEG, PNG or WebP/i);
    expect(createObjectURL).not.toHaveBeenCalled();

    await user.upload(input, new File([new Uint8Array([1])], "first.png", { type: "image/png" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    await user.upload(input, new File([new Uint8Array([2])], "second.webp", { type: "image/webp" }));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:first"));
    await user.click(screen.getByRole("button", { name: "Save Photo" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(expect.objectContaining({ name: "second.webp" }), 3, expect.any(String)));
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:second"));
    expect(await screen.findByRole("status")).toHaveTextContent("Profile picture updated successfully.");
    view.unmount();
  });

  it("keeps all three Profile password visibility controls independent", async () => {
    const user = userEvent.setup();
    renderPage(readyRuntime({
      userId: userId("profile-raiyan"), displayName: "Raiyan", displayEmail: "raiyan@test.io",
      profileVersion: 1, roleLabel: "Leader", householdName: "Lake View House", settlementActionCount: 0,
    }, true));
    const current = screen.getByLabelText("Current Password");
    const next = screen.getByLabelText("New Password");
    const confirmation = screen.getByLabelText("Confirm New Password");
    const toggles = screen.getAllByRole("button", { name: "Show password" });
    expect(toggles).toHaveLength(3);
    await user.click(toggles[1]!);
    expect(current).toHaveAttribute("type", "password");
    expect(next).toHaveAttribute("type", "text");
    expect(confirmation).toHaveAttribute("type", "password");
    expect(current).toHaveAttribute("autocomplete", "current-password");
    expect(next).toHaveAttribute("autocomplete", "new-password");
    expect(confirmation).toHaveAttribute("autocomplete", "new-password");
  });

  it("validates password confirmation without sending secrets and redirects to Login after success", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ updated: true }), {
      status: 200, headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", request);
    const user = userEvent.setup();
    renderPage(readyRuntime({
      userId: userId("profile-raiyan"), displayName: "Raiyan", displayEmail: "raiyan@test.io",
      profileVersion: 1,
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
