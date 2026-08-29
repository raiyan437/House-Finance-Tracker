import { NextResponse, type NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeState = vi.hoisted(() => ({ context: undefined as unknown as Record<string, unknown> }));

vi.mock("@/infrastructure/appwrite/runtime/read-route.server", () => ({
  runTrustedCommand: async (_request: NextRequest, _schema: unknown, handler: (context: Record<string, unknown>, parsed: Record<string, string>) => Promise<unknown>) => {
    try {
      const data = await handler(routeState.context, { receiptId: "r1", commandId: "c1" });
      return NextResponse.json({ data });
    } catch (error) {
      const value = error as { code?: string };
      return NextResponse.json({ error: "Receipt not found." }, { status: value.code === "NOT_FOUND" ? 404 : 500 });
    }
  },
}));

import { POST } from "./route";

describe("Receipt remove route capability", () => {
  const remove = vi.fn();

  beforeEach(() => remove.mockReset());

  it("does not invoke removal while Receipt mutations are disabled", async () => {
    routeState.context = { capabilities: { receiptMutations: false }, receiptOperations: { remove } };
    const response = await POST({} as NextRequest);
    expect(response.status).toBe(404);
    expect(remove).not.toHaveBeenCalled();
  });

  it("invokes removal after the server mutation capability is enabled", async () => {
    remove.mockResolvedValue({ receiptId: "r1", status: "user-deleted" });
    routeState.context = { capabilities: { receiptMutations: true }, receiptOperations: { remove } };
    const response = await POST({} as NextRequest);
    expect(response.status).toBe(200);
    expect(remove).toHaveBeenCalledWith({ receiptId: "r1", commandId: "c1" });
  });
});
