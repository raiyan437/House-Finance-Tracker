import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignupForm } from "./signup-form";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

describe("SignupForm", () => {
  beforeEach(() => {
    navigation.push.mockReset();
    navigation.refresh.mockReset();
    vi.unstubAllGlobals();
  });

  it("renders the approved three-field signup contract", () => {
    render(<SignupForm />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Confirm Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/display name|phone|verification/i)).not.toBeInTheDocument();
  });

  it("blocks mismatched and short passwords before the request and focuses the first invalid field", async () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const user = userEvent.setup();
    render(<SignupForm />);
    await user.type(screen.getByLabelText("Email"), "raiyan@test.io");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.type(screen.getByLabelText("Confirm Password"), "different");
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    expect(await screen.findByText("Password must be at least 8 characters.")).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Password")).toHaveFocus();
  });

  it("shows the explicit non-allowlisted error returned by the trusted endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Email not allowed. Contact admin." }),
      { status: 403, headers: { "content-type": "application/json" } },
    )));
    const user = userEvent.setup();
    render(<SignupForm />);
    await user.type(screen.getByLabelText("Email"), "other@test.io");
    await user.type(screen.getByLabelText("Password"), "new-password");
    await user.type(screen.getByLabelText("Confirm Password"), "new-password");
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email not allowed. Contact admin.");
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("offers Sign in and reset actions for an existing account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: "ACCOUNT_EXISTS", error: "An account already exists for this email. Sign in or reset your password." }),
      { status: 409, headers: { "content-type": "application/json" } },
    )));
    const user = userEvent.setup();
    render(<SignupForm />);
    await user.type(screen.getByLabelText("Email"), "raiyan@test.io");
    await user.type(screen.getByLabelText("Password"), "new-password");
    await user.type(screen.getByLabelText("Confirm Password"), "new-password");
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "reset your password" })).toHaveAttribute("href", "/forgot-password");
  });

  it("enters the application after authenticated signup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: "authenticated" }),
      { status: 201, headers: { "content-type": "application/json" } },
    )));
    const user = userEvent.setup();
    render(<SignupForm />);
    await user.type(screen.getByLabelText("Email"), "raiyan@test.io");
    await user.type(screen.getByLabelText("Password"), "new-password");
    await user.type(screen.getByLabelText("Confirm Password"), "new-password");
    await user.click(screen.getByRole("button", { name: "Create Account" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/dashboard"));
  });
});
