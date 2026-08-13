import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import Home from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("root route", () => {
  beforeEach(() => {
    vi.mocked(redirect).mockClear();
  });

  it("redirects to the primary dashboard destination", () => {
    Home();
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });
});
