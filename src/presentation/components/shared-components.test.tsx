import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { poisha } from "@/domain/money/poisha";
import { ChartCard } from "./chart-card";
import { ConfirmDialog } from "./confirm-dialog";
import { initialsFromDisplayName, MemberAvatar } from "./member-avatar";
import { StatusBadge } from "./status-badge";
import { FormField } from "../forms/form-field";
import { MoneyValue } from "../finance/money-value";

describe("shared presentation components", () => {
  it("derives deterministic member initials", () => {
    expect(initialsFromDisplayName("Raiyan Uddin")).toBe("RU");
    expect(initialsFromDisplayName(" John ")).toBe("J");
    expect(initialsFromDisplayName("Sarah Ahmed Khan")).toBe("SK");
    expect(initialsFromDisplayName("   ")).toBe("?");

    render(<MemberAvatar displayName="Raiyan Uddin" />);
    expect(screen.getByLabelText("Raiyan Uddin")).toHaveTextContent("RU");
  });

  it("links form labels, descriptions, and errors to the control", () => {
    render(
      <FormField
        description="Enter an ungrouped decimal amount."
        error="Enter a valid amount."
        label="Amount"
        required
      >
        <Input />
      </FormField>,
    );

    const input = screen.getByRole("textbox", { name: /Amount/ });
    expect(input).toBeRequired();
    expect(input).toHaveAccessibleDescription(
      "Enter an ungrouped decimal amount. Enter a valid amount.",
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("renders financial values and statuses with textual meaning", () => {
    render(
      <div>
        <MoneyValue value={poisha(425000)} />
        <StatusBadge tone="success">Confirmed</StatusBadge>
      </div>,
    );

    expect(screen.getByText("৳4,250.00")).toHaveClass("financial-numerals");
    expect(screen.getByText("Confirmed")).toBeVisible();
  });

  it("keeps an accessible textual summary beside the chart slot", () => {
    render(
      <ChartCard summary="Spending rose across the selected month." title="Spending trend">
        <div aria-label="Chart content" />
      </ChartCard>,
    );

    expect(screen.getByText(/spending rose across/i)).toBeVisible();
    expect(screen.getByLabelText("Chart content")).toBeInTheDocument();
  });

  it("returns focus after a confirmation dialog closes", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        confirmLabel="Confirm"
        description="This verifies the shared confirmation behavior."
        onConfirm={onConfirm}
        title="Continue?"
        trigger={<Button>Open confirmation</Button>}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Open confirmation" });
    await user.click(trigger);
    expect(screen.getByRole("alertdialog", { name: "Continue?" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(trigger).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
