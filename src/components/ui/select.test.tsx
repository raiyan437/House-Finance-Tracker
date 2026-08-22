import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

beforeAll(() => {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => undefined },
    scrollIntoView: { configurable: true, value: () => undefined },
    setPointerCapture: { configurable: true, value: () => undefined },
  });
});

describe("shared Select", () => {
  it("supports semantic keyboard selection and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(
      <Select defaultValue="all">
        <SelectTrigger aria-label="Payment method">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Payment Methods</SelectItem>
          <SelectItem value="cash">Cash</SelectItem>
          <SelectItem disabled value="card">Card</SelectItem>
        </SelectContent>
      </Select>,
    );

    const trigger = screen.getByRole("combobox", { name: "Payment method" });
    await user.click(trigger);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "Cash" })).toHaveAttribute("data-highlighted", "");
    expect(screen.getByRole("option", { name: "Card" })).toHaveAttribute("data-disabled", "");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("option", { name: "All Payment Methods" })).toHaveAttribute("data-highlighted", "");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");

    expect(trigger).toHaveTextContent("Cash");
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
