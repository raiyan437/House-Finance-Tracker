import { NextResponse, type NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({ resolveReadContext: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("./read-route.server", () => ({
  assertSameOrigin: () => true,
  mapReadError: (error: unknown) => {
    const value = error as { code?: string; message?: string };
    return value.code ? { status: value.code === "NOT_FOUND" ? 404 : 400, body: { error: value.message, code: value.code } } : undefined;
  },
  resolveReadContext: routeMocks.resolveReadContext,
}));

import { runReceiptContentRead, runReceiptUpload } from "./receipt-route.server";

function uploadRequest(body: ReadableStream<Uint8Array>, length: number): NextRequest {
  return {
    body,
    headers: new Headers({
      host: "localhost",
      origin: "http://localhost",
      "content-length": String(length),
      "content-type": "image/png",
      "x-command-id": "cmd-1",
      "x-expense-id": "expense-1",
    }),
  } as NextRequest;
}

describe("trusted Receipt route envelope", () => {
  beforeEach(() => {
    routeMocks.resolveReadContext.mockReset();
    vi.restoreAllMocks();
  });

  it("does not pull an upload body before authentication succeeds", async () => {
    let pulled = false;
    const body = { getReader() { pulled = true; throw new Error("body should remain unread"); } } as unknown as ReadableStream<Uint8Array>;
    routeMocks.resolveReadContext.mockResolvedValue({ status: new NextResponse(null, { status: 401 }) });

    await expect(runReceiptUpload(uploadRequest(body, 1))).resolves.toMatchObject({ status: 401 });
    expect(pulled).toBe(false);
  });

  it("does not attempt a Receipt binary read before authentication succeeds", async () => {
    const read = vi.fn();
    routeMocks.resolveReadContext.mockResolvedValue({ status: new NextResponse(null, { status: 401 }), context: { receiptOperations: { read } } });

    await expect(runReceiptContentRead({ headers: new Headers() } as NextRequest, "r1")).resolves.toMatchObject({ status: 401 });
    expect(read).not.toHaveBeenCalled();
  });

  it("enforces separate server-side read and mutation capabilities", async () => {
    const operations = { upload: vi.fn(), remove: vi.fn(), read: vi.fn() };
    routeMocks.resolveReadContext.mockResolvedValue({
      status: "ok",
      context: { capabilities: { receiptMutations: false, receiptContentReads: false }, receiptOperations: operations },
    });
    const unreadBody = { getReader: vi.fn() } as unknown as ReadableStream<Uint8Array>;

    await expect(runReceiptUpload(uploadRequest(unreadBody, 1))).resolves.toMatchObject({ status: 404 });
    await expect(runReceiptContentRead({ headers: new Headers() } as NextRequest, "r1")).resolves.toMatchObject({ status: 404 });
    expect(unreadBody.getReader).not.toHaveBeenCalled();
    expect(operations.upload).not.toHaveBeenCalled();
    expect(operations.read).not.toHaveBeenCalled();
  });

  it("streams an exact declared body to the upload saga when mutations are enabled", async () => {
    const upload = vi.fn().mockResolvedValue({ receiptId: "r1" });
    routeMocks.resolveReadContext.mockResolvedValue({
      status: "ok",
      context: { capabilities: { receiptMutations: true, receiptContentReads: false }, receiptOperations: { upload } },
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const response = await runReceiptUpload(uploadRequest(new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), bytes.byteLength));

    expect(response.status).toBe(200);
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ bytes }));
  });

  it("streams authorized Receipt content with private headers and no provider details", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const read = vi.fn().mockResolvedValue({ bytes, mimeType: "image/png", sizeBytes: bytes.byteLength });
    routeMocks.resolveReadContext.mockResolvedValue({
      status: "ok",
      context: { capabilities: { receiptMutations: false, receiptContentReads: true }, receiptOperations: { read } },
    });

    const response = await runReceiptContentRead({ headers: new Headers() } as NextRequest, "r1");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(read).toHaveBeenCalledWith("r1");
  });

  it("does not return or log raw provider failure details", async () => {
    const error = new Error("storageFileId=file-secret provider denied");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    routeMocks.resolveReadContext.mockResolvedValue({
      status: "ok",
      context: { capabilities: { receiptMutations: false, receiptContentReads: true }, receiptOperations: { read: vi.fn().mockRejectedValue(error) } },
    });

    const response = await runReceiptContentRead({ headers: new Headers() } as NextRequest, "r1");

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(error.message);
    expect(consoleError).toHaveBeenCalledWith("[receipt-route]", "Error");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(error.message);
  });

  it("stops an oversized or declared-length-mismatched stream before invoking upload", async () => {
    const upload = vi.fn();
    routeMocks.resolveReadContext.mockResolvedValue({
      status: "ok",
      context: { capabilities: { receiptMutations: true, receiptContentReads: false }, receiptOperations: { upload } },
    });
    const response = await runReceiptUpload(uploadRequest(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.close(); } }), 1));

    expect(response.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });
});
