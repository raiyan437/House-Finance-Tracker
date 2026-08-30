import { FULL_LOCAL_CAPABILITIES } from "@/application/runtime-capabilities";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { householdId, joinRequestId, userId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import { ApplicationRuntimeProvider } from "@/presentation/runtime/application-runtime-context";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileNavigation } from "./mobile-navigation";

let currentPathname = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

function renderWithRuntime(
  children: React.ReactNode,
  settlementActionCount = 0,
  joinRequestCount = 0,
  signOut?: () => Promise<void>,
) {
  return render(
    <ApplicationRuntimeProvider
      value={{
        status: "ready",
      capabilities: FULL_LOCAL_CAPABILITIES,
        session: {
          userId: userId("user-raiyan"),
          displayName: "Raiyan Uddin",
          displayEmail: "raiyan@local.test",
          profileVersion: 1,
          roleLabel: "Leader",
          householdName: "Raiyan House",
          settlementActionCount,
        },
        household: {
          status: "active-leader",
          household: {
            householdId: householdId("household-main"),
            name: "Raiyan House",
            code: "012345678",
          },
          page: {
            household: {
              householdId: householdId("household-main"),
              name: "Raiyan House",
              code: "012345678",
            },
            viewer: { memberId: userId("user-raiyan"), role: "leader" },
            leader: { memberId: userId("user-raiyan"), displayName: "Raiyan Uddin", role: "leader", roleLabel: "Leader", isCurrentUser: true },
            members: [{ memberId: userId("user-raiyan"), displayName: "Raiyan Uddin", role: "leader", roleLabel: "Leader", isCurrentUser: true }],
            leave: { eligible: false, blockers: [{ code: "HOUSEHOLD_DELETE_REQUIRED" }] },
            viewerRole: "leader",
            deleteHousehold: { eligible: true, blockers: [] },
          },
          joinRequests: Array.from({ length: joinRequestCount }, (_, index) => ({
            joinRequestId: joinRequestId(`join-request-${index + 1}`),
            requesterName: `Requester ${index + 1}`,
            createdAt: isoInstant("2026-08-22T10:00:00.000Z"),
          })),
        },
        signOut,
        householdActions: {
          generateCode: vi.fn(),
          createHousehold: vi.fn(),
          findHousehold: vi.fn(),
          requestToJoin: vi.fn(),
          cancelJoinRequest: vi.fn(),
          acceptJoinRequest: vi.fn(),
          rejectJoinRequest: vi.fn(),
          leaveHousehold: vi.fn(),
          renameHousehold: vi.fn(),
          removeMember: vi.fn(),
          transferLeadership: vi.fn(),
          deleteHousehold: vi.fn(),
          refresh: vi.fn(),
        },
        expenseActions: {
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
        },
        settlementActions: {
          getPage: vi.fn(),
          getPendingPreview: vi.fn(),
          markRecommendationPaid: vi.fn(),
          confirm: vi.fn(),
          reject: vi.fn(),
          cancel: vi.fn(),
        },
        cardActions: {
          getMyCards: vi.fn(), createMyCard: vi.fn(), updateMyCard: vi.fn(),
          getRemovalPreview: vi.fn(), deleteOrArchive: vi.fn(),
        },
        profileActions: { updateDisplayName: vi.fn() },
        analyticsActions: {
          getDashboard: vi.fn(),
          getMonthlyReport: vi.fn(),
        },
      }}
    >
      {children}
    </ApplicationRuntimeProvider>,
  );
}

describe("responsive navigation", () => {
  beforeEach(() => {
    currentPathname = "/dashboard";
  });

  it("marks the active desktop destination and explains unavailable logout", () => {
    renderWithRuntime(<DesktopSidebar />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("Raiyan Uddin")).toBeVisible();
    expect(screen.getByText("Leader")).toBeVisible();
    const logout = screen.getByRole("button", { name: "Log Out" });
    expect(logout).toHaveAttribute("aria-disabled", "true");
    expect(logout).toHaveAccessibleDescription(
      "Sign out is unavailable in this runtime.",
    );
  });

  it("keeps the desktop logout wired to the runtime action", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(async () => undefined);
    renderWithRuntime(<DesktopSidebar />, 0, 0, signOut);

    await user.click(screen.getByRole("button", { name: "Log Out" }));

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("smoothly collapses the desktop shell while keeping controls accessible", async () => {
    const user = userEvent.setup();
    renderWithRuntime(<DesktopSidebar />);

    const sidebar = screen.getByRole("navigation", { name: "Primary navigation" }).parentElement;
    const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(sidebar).toHaveAttribute("data-sidebar-collapsed", "false");
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeVisible();

    await user.click(collapse);

    expect(sidebar).toHaveAttribute("data-sidebar-collapsed", "true");
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open profile for Raiyan Uddin" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(sidebar).toHaveAttribute("data-sidebar-collapsed", "false");
  });

  it("exposes destinations and the separated final Log Out action through the mobile More sheet", async () => {
    const user = userEvent.setup();
    renderWithRuntime(<MobileNavigation />);

    await user.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("dialog", { name: "More" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Cards" })).toHaveAttribute(
      "href",
      "/cards",
    );
    expect(screen.getByRole("link", { name: "Household" })).toHaveAttribute(
      "href",
      "/household",
    );
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute(
      "href",
      "/profile",
    );
    const logout = screen.getByRole("button", { name: "Log Out" });
    expect(logout.parentElement).toHaveClass("border-t");
    expect(logout).toHaveAttribute("aria-disabled", "true");
    expect(logout).toHaveAccessibleDescription("Sign out is unavailable in this runtime.");
    expect(logout).toHaveClass("min-h-12");
  });

  it("reuses the runtime logout action and blocks repeated mobile submissions", async () => {
    const user = userEvent.setup();
    let resolveSignOut: (() => void) | undefined;
    const signOut = vi.fn(() => new Promise<void>((resolve) => {
      resolveSignOut = resolve;
    }));
    renderWithRuntime(<MobileNavigation />, 0, 0, signOut);

    await user.click(screen.getByRole("button", { name: "More" }));
    const logout = screen.getByRole("button", { name: "Log Out" });
    await user.dblClick(logout);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Log Out" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Log Out" })).toBeDisabled();
    expect(screen.getByText("Logging Out…")).toBeVisible();

    resolveSignOut?.();
    expect(await screen.findByText("Log Out")).toBeVisible();
  });

  it("keeps Add distinct from the Expenses active state", () => {
    currentPathname = "/expenses/new";
    renderWithRuntime(<MobileNavigation />);

    expect(screen.getByRole("link", { name: "Add" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Expenses" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps mobile navigation icon-only while retaining accessible names", () => {
    renderWithRuntime(<MobileNavigation />);

    const navigation = screen.getByRole("navigation", { name: "Mobile navigation" });
    expect(navigation).not.toHaveTextContent("Dashboard");
    expect(navigation).not.toHaveTextContent("Expenses");
    expect(navigation).not.toHaveTextContent("Settlements");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "title",
      "Dashboard",
    );
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute(
      "title",
      "More",
    );
  });
});

describe("settlement attention badge", () => {
  it("announces only the derived receiver-action count in desktop and mobile navigation", () => {
    const desktop = renderWithRuntime(<DesktopSidebar />, 2);
    expect(screen.getByLabelText("2 settlement actions waiting for you")).toHaveTextContent("2");
    desktop.unmount();

    renderWithRuntime(<MobileNavigation />, 2);
    expect(screen.getByRole("link", { name: "Settlements, 2 actions waiting for you" })).toBeInTheDocument();
  });
});

describe("leader join request attention badge", () => {
  it("announces pending review counts on the desktop Household destination", () => {
    const single = renderWithRuntime(<DesktopSidebar />, 0, 1);
    expect(screen.getByLabelText("1 join request waiting for your review")).toHaveTextContent("1");
    expect(screen.queryByLabelText(/settlement .* waiting/)).not.toBeInTheDocument();
    single.unmount();

    renderWithRuntime(<DesktopSidebar />, 0, 3);
    expect(screen.getByLabelText("3 join requests waiting for your review")).toHaveTextContent("3");
  });

  it("keeps destinations without attention free of badges", () => {
    renderWithRuntime(<DesktopSidebar />, 0, 0);
    expect(screen.queryByLabelText(/waiting for your review/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/settlement .* waiting/)).not.toBeInTheDocument();
  });

  it("surfaces pending reviews on the mobile More trigger and its sheet Household row", async () => {
    const user = userEvent.setup();
    renderWithRuntime(<MobileNavigation />, 0, 2);

    const more = screen.getByRole("button", { name: "More, 2 join requests waiting for your review" });
    expect(more).toBeInTheDocument();
    expect(more).toHaveTextContent("2");

    await user.click(more);
    const dialog = screen.getByRole("dialog", { name: "More" });
    expect(
      within(dialog).getByRole("link", { name: "Household, 2 join requests waiting for your review" }),
    ).toHaveAttribute("href", "/household");
  });

  it("leaves More unlabeled when no review is waiting", () => {
    renderWithRuntime(<MobileNavigation />, 0, 0);
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });
});
