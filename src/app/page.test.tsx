import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("project foundation page", () => {
  it("states that Phase 1 is ready without claiming product features exist", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { name: "House Finance Tracker" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/product features.+have not started/i)).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
