import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeWithBigInt } from "@/application/transport/json-bigint";
import { BEFORE_WRITE_EVENT, SESSION_EXPIRED_EVENT, requestJson, requestResponse } from "./production-transport";

describe("production transport recovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("retries transient GET responses twice, preserving integer poisha", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("gateway", { status: 502 }))
      .mockResolvedValueOnce(new Response(serializeWithBigInt({ data: { amount: BigInt("9007199254740993") } })));
    vi.stubGlobal("fetch", fetch);
    const result = requestJson<{ amount: bigint }>("/api/app/dashboard");
    await vi.advanceTimersByTimeAsync(2000);
    expect((await result).amount).toBe(BigInt("9007199254740993"));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.each([400, 401, 403, 404, 409, 429, 500])("does not retry HTTP %s", async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response("<html>provider detail</html>", { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(requestJson("/api/app/test")).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("invalidates a protected 401 immediately even when the response body stalls", async () => {
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream(), { status: 401 })));
    try {
      await expect(requestJson("/api/app/test")).rejects.toMatchObject({ code: "SESSION_UNAVAILABLE" });
      expect(expired).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener(SESSION_EXPIRED_EVENT, expired); }
  });

  it("retains Login credential errors without announcing session expiry", async () => {
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"Invalid credentials."}', { status: 401 })));
    try {
      await expect(requestJson("/api/auth/login", { method: "POST" })).rejects.toMatchObject({ message: "Invalid credentials." });
      expect(expired).not.toHaveBeenCalled();
    } finally { window.removeEventListener(SESSION_EXPIRED_EVENT, expired); }
  });

  it("does not replay a POST after a transient failure or lost response", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("network failure"));
    vi.stubGlobal("fetch", fetch);
    await expect(requestJson("/api/app/expense-create", { method: "POST" })).rejects.toMatchObject({ message: expect.stringContaining("could not confirm") });
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds stalled POST bodies and reports unknown outcome", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream(), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = expect(requestJson("/api/app/expense-create", { method: "POST" })).rejects.toMatchObject({ status: 0 });
    await vi.advanceTimersByTimeAsync(35_000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry a denial when its body stalls", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream(), { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    const result = expect(requestJson("/api/app/test")).rejects.toMatchObject({ status: 403, code: "COMMANDS_UNAVAILABLE" });
    await vi.advanceTimersByTimeAsync(35_000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds all GET attempts by the 45-second total deadline", async () => {
    const fetch = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetch);
    const result = expect(requestJson("/api/app/test")).rejects.toMatchObject({ status: 0 });
    await vi.advanceTimersByTimeAsync(45_000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cancels during retry backoff without another request", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const result = expect(requestJson("/api/app/test", undefined, { signal: controller.signal })).rejects.toMatchObject({ status: 0 });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await result;
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("blocks a new write during recovery but allows an already-started Receipt continuation", async () => {
    const block = (event: Event) => event.preventDefault();
    window.addEventListener(BEFORE_WRITE_EVENT, block);
    const fetch = vi.fn().mockResolvedValue(new Response('{"data":null}'));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(requestJson("/api/app/test", { method: "POST" })).rejects.toMatchObject({ code: "COMMANDS_UNAVAILABLE" });
      expect(fetch).not.toHaveBeenCalled();
      await requestJson("/api/app/receipt-upload", { method: "POST" }, { continuation: true });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener(BEFORE_WRITE_EVENT, block); }
  });

  it("rejects malformed successful JSON without retry and preserves binary bytes", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("<html>wrong</html>"))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 255]), { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(requestJson("/api/app/test")).rejects.toMatchObject({ message: expect.stringContaining("unreadable") });
    const response = await requestResponse("/api/app/receipts/r1/content");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 255]));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
