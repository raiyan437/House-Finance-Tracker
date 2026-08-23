import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DevelopmentIdentityOption } from "./development-tools";
import { DevelopmentTools, DevelopmentToolsProvider, MobileDevelopmentTools } from "./development-tools";
import { userId } from "@/domain/shared/identifiers";

const identity: DevelopmentIdentityOption = { userId: userId("raiyan"), displayName: "Raiyan" };

function withProvider(children: React.ReactNode) {
  return (
    <DevelopmentToolsProvider
      value={{ identities: [identity], currentUserId: identity.userId, onSwitchIdentity: vi.fn().mockResolvedValue(undefined) }}
    >
      {children}
    </DevelopmentToolsProvider>
  );
}

afterEach(cleanup);

describe("Development tools production gate", () => {
  it("renders when the composition root provides development identities", () => {
    render(withProvider(
      <>
        <DevelopmentTools />
        <MobileDevelopmentTools />
      </>,
    ));
    expect(screen.getByRole("button", { name: "Open development tools" })).toBeInTheDocument();
    expect(screen.getByText("DEV · Development tools")).toBeInTheDocument();
  });

  it("renders nothing when the composition root omits the context (production builds)", () => {
    render(
      <>
        <DevelopmentTools />
        <MobileDevelopmentTools />
      </>,
    );
    expect(screen.queryByRole("button", { name: "Open development tools" })).not.toBeInTheDocument();
    expect(screen.queryByText("DEV · Development tools")).not.toBeInTheDocument();
    expect(screen.queryByTestId("development-tools-trigger")).not.toBeInTheDocument();
  });
});
