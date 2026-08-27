import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRODUCTION_R2_CAPABILITIES } from "@/application/runtime-capabilities";
import { commandId, householdId, joinRequestId, userId } from "@/domain/shared/identifiers";
import { useApplicationRuntime } from "@/presentation/runtime/application-runtime-context";

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
      capabilities: PRODUCTION_R2_CAPABILITIES,
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

  it("delivers all ten Household actions to their same-origin command routes and refreshes", async () => {
    currentPathname = "/household";
    const commands: Array<{ path: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const path = String(input);
      if (path === "/api/app/bootstrap") return new Response(JSON.stringify(bootstrapPayload()), { status: 200 });
      commands.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ data: null }), { status: 200 });
    });
    render(<ProductionApplicationRuntime><HouseholdCommandProbe /></ProductionApplicationRuntime>);
    expect(await screen.findByRole("button", { name: "create" })).toBeEnabled();

    let expectedCount = 0;
    for (const name of ["create", "request", "cancel", "accept", "reject", "leave", "remove", "transfer", "rename", "delete"]) {
      screen.getByRole("button", { name }).click();
      expectedCount += 1;
      await waitFor(() => expect(commands).toHaveLength(expectedCount));
    }
    await waitFor(() => expect(commands).toHaveLength(10));
    expect(commands.map((entry) => entry.path)).toEqual([
      "/api/app/household-create",
      "/api/app/household-request-join",
      "/api/app/household-cancel-request",
      "/api/app/household-accept-request",
      "/api/app/household-reject-request",
      "/api/app/household-leave",
      "/api/app/household-remove-member",
      "/api/app/household-transfer-leadership",
      "/api/app/household-rename",
      "/api/app/household-delete",
    ]);
    expect(commands.every((entry) => typeof entry.body.commandId === "string")).toBe(true);
  });
});

function HouseholdCommandProbe() {
  const runtime = useApplicationRuntime();
  if (runtime.status !== "ready") return null;
  const actions = runtime.householdActions;
  const invoke = (work: () => Promise<void>) => () => { void work().catch(() => undefined); };
  return <div>
    <button onClick={invoke(() => actions.createHousehold("Home", "000000001", commandId("create-command")))}>create</button>
    <button onClick={invoke(() => actions.requestToJoin(householdId("h1"), commandId("join-command")))}>request</button>
    <button onClick={invoke(() => actions.cancelJoinRequest(joinRequestId("j1")))}>cancel</button>
    <button onClick={invoke(() => actions.acceptJoinRequest(joinRequestId("j1")))}>accept</button>
    <button onClick={invoke(() => actions.rejectJoinRequest(joinRequestId("j1")))}>reject</button>
    <button onClick={invoke(() => actions.leaveHousehold())}>leave</button>
    <button onClick={invoke(() => actions.removeMember(userId("u2")))}>remove</button>
    <button onClick={invoke(() => actions.transferLeadership(userId("u2")))}>transfer</button>
    <button onClick={invoke(() => actions.renameHousehold("Renamed"))}>rename</button>
    <button onClick={invoke(() => actions.deleteHousehold())}>delete</button>
  </div>;
}

function fireEventClickRetry(): void {
  const retry = screen.getByRole("button", { name: "Retry" });
  retry.click();
}
