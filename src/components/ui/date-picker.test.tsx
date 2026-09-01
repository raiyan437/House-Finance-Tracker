import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { DatePicker } from "./date-picker";

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => undefined },
    scrollIntoView: { configurable: true, value: () => undefined },
    setPointerCapture: { configurable: true, value: () => undefined },
  });
});

describe("shared DatePicker", () => {
  it("renders the project control and preserves a canonical date-only selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker aria-label="Expense Date" onChange={onChange} value="2026-08-22" />);

    const trigger = screen.getByRole("button", { name: "Expense Date" });
    expect(trigger).toHaveTextContent("22 Aug 2026");
    expect(document.querySelector('input[type="date"]')).toBeNull();

    await user.click(trigger);
    expect(screen.getByRole("button", { name: "Previous month" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /^23 August 2026(, today)?$/ }));
    expect(onChange).toHaveBeenCalledWith("2026-08-23");
  });

  it("supports keyboard calendar navigation and returns focus after Escape", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<><button type="button">Before</button><DatePicker aria-label="Expense Date" onChange={onChange} value="2026-08-22" /></>);

    const trigger = screen.getByRole("button", { name: "Expense Date" });
    screen.getByRole("button", { name: "Before" }).focus();
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("button", { name: /22 August 2026/ })).toHaveFocus());
    await user.keyboard("{ArrowRight} ");
    expect(onChange).toHaveBeenCalledWith("2026-08-23");

    await user.click(trigger);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps old and future dates visible but disabled and bounds month navigation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        aria-label="Expense Date"
        min="2026-07-01"
        max="2026-09-15"
        onChange={onChange}
        value="2026-09-15"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Expense Date" }));
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "30 June 2026" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1 July 2026" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "1 July 2026" }));
    expect(onChange).toHaveBeenCalledWith("2026-07-01");
  });
});
