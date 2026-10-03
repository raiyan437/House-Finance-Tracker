"use client";

import { ApplicationError, BackdatedExpenseConfirmationRequiredError, type ApplicationErrorCode } from "@/application/errors/application-error";
import { parseWithBigInt } from "@/application/transport/json-bigint";

export const SESSION_EXPIRED_EVENT = "hft:session-expired";
export const FORBIDDEN_EVENT = "hft:request-forbidden";
export const BEFORE_WRITE_EVENT = "hft:before-write";
const RETRY_DELAYS = [500, 1500];
const ATTEMPT_TIMEOUT = 35_000;
const READ_BUDGET = 45_000;

export interface TransportOptions {
  readonly signal?: AbortSignal;
  /** Only the remaining operations of an already-started Receipt saga. */
  readonly continuation?: boolean;
}

function protectedPath(path: string): boolean {
  return path.startsWith("/api/app/") || path === "/api/auth/password";
}

export function assertProductionWriteAllowed(): void {
  if (!window.dispatchEvent(new Event(BEFORE_WRITE_EVENT, { cancelable: true }))) {
    throw new ApplicationError("COMMANDS_UNAVAILABLE", "Reconnect before saving. Your draft is still here.");
  }
}

function unavailable(read: boolean): ApplicationError & { status: number } {
  return Object.assign(new ApplicationError("PERSISTENCE_FAILURE", read
    ? "The service is temporarily unavailable. Please retry."
    : "We could not confirm whether this action completed. Check the current state before retrying."), { status: 0 });
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new DOMException("Request cancelled", "AbortError"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([work, aborted]); }
  finally { signal.removeEventListener("abort", onAbort); }
}

async function pause(delay: number, signal?: AbortSignal): Promise<void> {
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await abortable(new Promise<void>((resolve) => { timer = setTimeout(resolve, delay); }), combined); }
  finally { clearTimeout(timer); }
}

/** Buffer the entire response within the deadline, including stalled bodies. */
export async function requestResponse(path: string, init?: RequestInit, options: TransportOptions = {}): Promise<Response> {
  const read = (init?.method ?? "GET").toUpperCase() === "GET";
  const protectedRequest = protectedPath(path);
  if (!read && protectedRequest && !options.continuation) assertProductionWriteAllowed();
  const deadline = Date.now() + (read ? READ_BUDGET : ATTEMPT_TIMEOUT);
  const outerSignal = options.signal ?? init?.signal ?? undefined;
  for (let attempt = 0; ; attempt += 1) {
    if (outerSignal?.aborted || Date.now() >= deadline) throw unavailable(read);
    const controller = new AbortController();
    const signal = outerSignal ? AbortSignal.any([controller.signal, outerSignal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), Math.min(ATTEMPT_TIMEOUT, deadline - Date.now()));
    let response: Response | undefined;
    try {
      response = await abortable(fetch(path, { ...init, cache: "no-store", signal }), signal);
      if (protectedRequest && response.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      if (protectedRequest && response.status === 403) window.dispatchEvent(new CustomEvent(FORBIDDEN_EVENT, { detail: { path } }));
      // Session invalidation may abort the read before its body is consumed.
      if (protectedRequest && response.status === 401) return new Response('{"error":"Your session has expired. Sign in again."}', { status: 401 });
      const bytes = await abortable(response.arrayBuffer(), signal);
      if (!read || ![502, 503, 504].includes(response.status) || attempt >= RETRY_DELAYS.length) {
        return new Response(bytes.byteLength ? bytes : null, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
    } catch {
      if (outerSignal?.aborted || !read || attempt >= RETRY_DELAYS.length) throw unavailable(read);
    } finally { clearTimeout(timer); }
    if (outerSignal?.aborted || Date.now() >= deadline) throw unavailable(read);
    try { await pause(Math.min(RETRY_DELAYS[attempt], deadline - Date.now()), outerSignal); }
    catch { throw unavailable(read); }
  }
}

export async function requestJson<T>(path: string, init?: RequestInit, options?: TransportOptions): Promise<T> {
  const response = await requestResponse(path, {
    ...init, headers: { accept: "application/json", ...(init?.headers ?? {}) },
  }, options);
  let payload: { data?: T; error?: string; code?: ApplicationErrorCode; confirmationToken?: string } = {};
  const text = await response.text();
  try {
    if (!text && response.ok && response.status !== 204) throw new Error("Empty response");
    const decoded: unknown = text ? parseWithBigInt(text) : {};
    if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Invalid envelope");
    payload = decoded as typeof payload;
  } catch {
    if (response.ok) {
      if ((init?.method ?? "GET").toUpperCase() !== "GET") throw unavailable(false);
      throw new ApplicationError("PERSISTENCE_FAILURE", "The service returned an unreadable response. Please retry.");
    }
  }
  if (!response.ok) {
    if (payload.code === "BACKDATED_EXPENSE_CONFIRMATION_REQUIRED" && typeof payload.confirmationToken === "string") {
      throw Object.assign(new BackdatedExpenseConfirmationRequiredError(payload.confirmationToken), { status: response.status });
    }
    const code = payload.code ?? (response.status === 401 ? "SESSION_UNAVAILABLE"
      : response.status === 403 ? "COMMANDS_UNAVAILABLE"
      : response.status === 404 ? "NOT_FOUND" : response.status === 409 ? "CONFLICT"
      : response.status === 429 ? "RATE_LIMITED" : "PERSISTENCE_FAILURE");
    const fallback = response.status === 403 ? "This action is not permitted." : "The service is temporarily unavailable. Please retry.";
    throw Object.assign(new ApplicationError(code, typeof payload.error === "string" ? payload.error : fallback), { status: response.status, body: payload });
  }
  return (payload.data ?? payload) as T;
}
