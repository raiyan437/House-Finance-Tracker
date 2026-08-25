import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRODUCTION_READ_ONLY_CAPABILITIES } from "@/application/runtime-capabilities";

const replace = vi.fn();
let currentPathname = "/household";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => currentPathname,
}));

import { ProductionApplicationRuntime } from "./production-application-runtime.client";

function bootstrapPayload() {
  return {
    data: {
      session: {
        userId: "user_abc",
        displayName: "Raiyan",
        displayEmail: "raiyan@test.io",
        roleLabel: "No active household",
        settlementActionCount: 0,
      },
      household: { status: "no-household" },
      capabilities: PRODUCTION_READ_ONLY_CAPABILITIES,
      businessDate: "2026-08-27",
    },
  };
}

const originalFetch = globalThis.fetch;

describe("production application runtime composition", () => {
  beforeEach(() => {
    replace.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders the real AppShell with children from the bootstrap endpoint", async () => {
    currentPathname = "/household";
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(bootstrapPayload()), { status: 200 }));
    render(
      <ProductionApplicationRuntime>
        <div>ROUTE_CHILDREN</div>
      </ProductionApplicationRuntime>,
    );
    expect(await screen.findByText("ROUTE_CHILDREN")).toBeInTheDocument();
    expect(document.querySelector('[data-slot="app-shell"]')).not.toBeNull();
    expect(screen.getByText("Raiyan")).toBeInTheDocument();
    // DEV identity tooling is never rendered in production composition.
    expect(screen.queryByRole("button", { name: "Open development tools" })).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps the frozen HouseholdAccessGate authoritative on household-required routes", async () => {
    currentPathname = "/dashboard";
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(bootstrapPayload()), { status: 200 }));
    render(
      <ProductionApplicationRuntime>
        <div>DASHBOARD_CHILDREN</div>
      </ProductionApplicationRuntime>,
    );
    expect(await screen.findByText("Opening household onboarding")).toBeInTheDocument();
    expect(screen.queryByText("DASHBOARD_CHILDREN")).toBeNull();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/household"));
  });

  it("redirects anonymous sessions to login without rendering route children", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Sign in to continue." }), { status: 401 }));
    render(
      <ProductionApplicationRuntime>
        <div>SECRET_CHILDREN</div>
      </ProductionApplicationRuntime>,
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("SECRET_CHILDREN")).toBeNull();
  });

  it("shows a retrying unavailable state when the data plane cannot be reached", async () => {
    const failing = vi.fn().mockRejectedValue(new TypeError("network down"));
    globalThis.fetch = failing as unknown as typeof fetch;
    render(
      <ProductionApplicationRuntime>
        <div>CHILD</div>
      </ProductionApplicationRuntime>,
    );
    expect(await screen.findByText("Service temporarily unavailable")).toBeInTheDocument();
    expect(failing).toHaveBeenCalled();

    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(bootstrapPayload()), { status: 200 }));
    fireEventClickRetry();
    await waitFor(() => expect(screen.queryByText("Service temporarily unavailable")).toBeNull());
  });
});

function fireEventClickRetry(): void {
  const retry = screen.getByRole("button", { name: "Retry" });
  retry.click();
}
