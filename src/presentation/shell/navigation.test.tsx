import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { householdId, userId } from "@/domain/shared/identifiers";
import { ApplicationRuntimeProvider } from "@/presentation/runtime/application-runtime-context";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileNavigation } from "./mobile-navigation";

let currentPathname = "/dashboard";

vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

function renderWithRuntime(children: React.ReactNode) {
  return render(
    <ApplicationRuntimeProvider
      value={{
        status: "ready",
        session: {
          userId: userId("user-raiyan"),
          displayName: "Raiyan Uddin",
          displayEmail: "raiyan@local.test",
          roleLabel: "Leader",
          householdName: "Raiyan House",
        },
        household: {
          status: "active-leader",
          household: {
            householdId: householdId("household-main"),
            name: "Raiyan House",
            code: "012345678",
          },
          joinRequests: [],
        },
        householdActions: {
          generateCode: vi.fn(),
          createHousehold: vi.fn(),
          findHousehold: vi.fn(),
          requestToJoin: vi.fn(),
          cancelJoinRequest: vi.fn(),
          acceptJoinRequest: vi.fn(),
          rejectJoinRequest: vi.fn(),
          refresh: vi.fn(),
        },
        expenseActions: {
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
      "Authentication is introduced in a later phase.",
    );
  });

  it("exposes Cards, Household, and Profile through the mobile More sheet", async () => {
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
});
