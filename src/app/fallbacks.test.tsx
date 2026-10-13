import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import NotFound from "./not-found";
import RootError from "./error";
import GlobalError from "./global-error";
import ProductError from "./(product)/error";

describe("fallback recovery and privacy", () => {
  for (const [name, Fallback] of [["root", RootError], ["product", ProductError]] as const) {
    it(`${name} error keeps its existing retry callback and invokes it once`, () => {
      const reset = vi.fn();
      render(<Fallback reset={reset} />);
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(reset).toHaveBeenCalledTimes(1);
    });
  }
  it("unknown routes retain a real Dashboard recovery link", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Back to Dashboard" })).toHaveAttribute("href", "/dashboard");
  });
  it("fatal fallback supplies its own document and sanitized content", () => {
    const markup = renderToStaticMarkup(<GlobalError reset={vi.fn()} />);
    expect(markup).toContain('<html lang="en">');
    expect(markup).toContain("<body");
    expect(markup).toContain("The app could not be displayed.");
    expect(markup).not.toMatch(/stack|digest|Appwrite|userId/);
  });
});
