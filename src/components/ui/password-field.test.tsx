import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { PasswordField } from "./password-field";

it("toggles locally without changing the value or submitting its form", async () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const user = userEvent.setup();
  render(
    <form onSubmit={submit}>
      <PasswordField id="test-password" name="password" label="Password" autoComplete="current-password" defaultValue="secret-value" />
    </form>,
  );

  const input = screen.getByLabelText("Password");
  const toggle = screen.getByRole("button", { name: "Show password" });
  expect(input).toHaveAttribute("type", "password");
  expect(input).toHaveAttribute("autocomplete", "current-password");
  expect(toggle).toHaveAttribute("type", "button");
  expect(toggle).toHaveAttribute("aria-pressed", "false");

  await user.tab();
  expect(input).toHaveFocus();
  await user.tab();
  expect(toggle).toHaveFocus();
  await user.keyboard(" ");
  expect(input).toHaveAttribute("type", "text");
  expect(input).toHaveValue("secret-value");
  expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  expect(submit).not.toHaveBeenCalled();

  await user.keyboard("{Shift>}{Tab}{/Shift}");
  expect(input).toHaveFocus();
  await user.tab();
  await user.keyboard("{Enter}");
  expect(input).toHaveAttribute("type", "password");
  expect(input).toHaveValue("secret-value");
  expect(submit).not.toHaveBeenCalled();

  await user.click(input);
  await user.click(toggle);
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute("type", "text");
});
