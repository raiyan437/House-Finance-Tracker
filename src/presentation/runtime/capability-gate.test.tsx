import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRODUCTION_READ_ONLY_CAPABILITIES } from "@/application/runtime-capabilities";
import type { ApplicationRuntimeState } from "@/presentation/runtime/application-runtime-context";
import { ApplicationRuntimeProvider } from "@/presentation/runtime/application-runtime-context";
import { CreateHouseholdForm } from "@/presentation/household/create-household-form.client";
import { CapabilityNotice, MUTATION_PENDING_NOTICE } from "./capability-gate.client";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/household/create",
}));

function readyState(capabilities: typeof PRODUCTION_READ_ONLY_CAPABILITIES): ApplicationRuntimeState {
  return {
    status: "ready",
    session: {
      userId: "user-raiyan" as never,
      displayName: "Raiyan",
      displayEmail: "raiyan@test.io",
      roleLabel: "No active household",
      settlementActionCount: 0,
    },
    household: { status: "no-household" },
    capabilities,
    householdActions: {
      generateCode: vi.fn().mockResolvedValue("012345678"),
      createHousehold: vi.fn(),
      findHousehold: vi.fn(),
      requestToJoin: vi.fn(),
      cancelJoinRequest: vi.fn(),
      acceptJoinRequest: vi.fn(),
      rejectJoinRequest: vi.fn(),
      leaveHousehold: vi.fn(),
      renameHousehold: vi.fn(),
      removeMember: vi.fn(),
      transferLeadership: vi.fn(),
      deleteHousehold: vi.fn(),
      refresh: vi.fn(),
    },
    expenseActions: {} as never,
    settlementActions: {} as never,
    cardActions: {} as never,
    analyticsActions: {} as never,
  };
}

describe("production capability gating", () => {
  beforeEach(() => {
    replace.mockClear();
  });

  it("disables production mutation controls with the restrained notice", () => {
    render(
      <ApplicationRuntimeProvider value={readyState(PRODUCTION_READ_ONLY_CAPABILITIES)}>
        <CreateHouseholdForm />
        <CapabilityNotice active>custom note</CapabilityNotice>
      </ApplicationRuntimeProvider>,
    );
    const submit = screen.getByRole("button", { name: "Create Household" });
    expect(submit).toBeDisabled();
    // The read-side generator stays available.
    expect(screen.getByRole("button", { name: /Generate Code/i })).toBeEnabled();
    expect(screen.getAllByText(MUTATION_PENDING_NOTICE).length).toBeGreaterThan(0);
    expect(screen.getByText("custom note")).toBeInTheDocument();
  });

  it("keeps local composition controls fully enabled", async () => {
    const user = (await import("@testing-library/user-event")).default;
    const state = readyState({
      householdMutations: true,
      expenseMutations: true,
      settlementMutations: true,
      cardMutations: true,
      receiptMutations: true,
      receiptContentReads: true,
      profileMutations: true,
    });
    render(
      <ApplicationRuntimeProvider value={state}>
        <CreateHouseholdForm />
      </ApplicationRuntimeProvider>,
    );
    const submit = screen.getByRole("button", { name: "Create Household" });
    expect(submit).toBeEnabled();

    const nameInput = screen.getByLabelText(/House Name/i);
    const codeInput = screen.getByLabelText(/House Code/i);
    fireEvent.change(nameInput, { target: { value: "Raiyan House" } });
    fireEvent.change(codeInput, { target: { value: "012345678" } });
    await user.click(submit);
    const ready = state as Extract<ApplicationRuntimeState, { status: "ready" }>;
    await waitFor(() => expect(ready.householdActions.createHousehold).toHaveBeenCalled());
    expect(screen.queryByText(MUTATION_PENDING_NOTICE)).toBeNull();
  });
});
