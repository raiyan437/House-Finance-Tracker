import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { ApplicationError } from "@/application/errors/application-error";
import { serializeWithBigInt } from "@/application/transport/json-bigint";
import { MAX_RECEIPT_BYTES } from "@/domain/records/domain-records";
import { TransactionFailure } from "./tx-errors.server";
import {
  assertSameOrigin,
  mapReadError,
  resolveReadContext,
} from "./read-route.server";
import type {
  ReceiptMimeType,
  ReceiptUploadInput,
} from "./receipt-operations.server";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json",
} as const;
const MAX_FILENAME_HEADER_BYTES = 600;
const COMMAND_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/u;
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/u;
const RECEIPT_MIME_TYPES = new Set<ReceiptMimeType>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function json(data: unknown, status = 200): NextResponse {
  return new NextResponse(serializeWithBigInt(data), {
    status,
    headers: JSON_HEADERS,
  });
}

function sameOrigin(request: NextRequest): boolean {
  return assertSameOrigin(
    request.headers.get("origin") ?? "",
    request.headers.get("host"),
  );
}

function mapReceiptRouteFailure(error: unknown): NextResponse {
  if (error instanceof TransactionFailure) {
    const status = error.kind === "conflict" ? 409 : 503;
    const message = error.kind === "conflict"
      ? "The household state changed concurrently. Review the current state and retry."
      : "The service is temporarily busy. Please retry shortly.";
    return json({ error: message, kind: error.kind }, status);
  }
  const mapped = mapReadError(error);
  if (mapped) return json(mapped.body, mapped.status);
  console.error("[receipt-route]", error instanceof Error ? error.message : error);
  return json({ error: "The service is temporarily unavailable." }, 503);
}

function requiredHeader(request: NextRequest, name: string): string {
  const value = request.headers.get(name)?.trim();
  if (!value) throw new ApplicationError("INVALID_INPUT", "The receipt request is invalid.");
  return value;
}

function parseUploadHeaders(request: NextRequest): Omit<ReceiptUploadInput, "bytes"> {
  const expenseId = requiredHeader(request, "x-expense-id");
  const commandId = requiredHeader(request, "x-command-id");
  if (!RESOURCE_ID_PATTERN.test(expenseId) || !COMMAND_ID_PATTERN.test(commandId)) {
    throw new ApplicationError("INVALID_INPUT", "The receipt request is invalid.");
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !RECEIPT_MIME_TYPES.has(contentType as ReceiptMimeType)) {
    throw new ApplicationError("RECEIPT_CONTENT_MISMATCH", "Receipt content is not a valid supported image.");
  }
  const encodedFilename = request.headers.get("x-receipt-filename");
  if (encodedFilename && new TextEncoder().encode(encodedFilename).byteLength > MAX_FILENAME_HEADER_BYTES) {
    throw new ApplicationError("INVALID_INPUT", "Receipt filename is invalid.");
  }
  let originalFilename: string | undefined;
  try {
    originalFilename = encodedFilename ? decodeURIComponent(encodedFilename) : undefined;
  } catch {
    throw new ApplicationError("INVALID_INPUT", "Receipt filename is invalid.");
  }
  return {
    expenseId,
    commandId,
    mimeType: contentType as ReceiptMimeType,
    ...(originalFilename ? { originalFilename } : {}),
  };
}

export async function readBoundedReceiptBody(request: NextRequest, declaredLength: number): Promise<Uint8Array> {
  if (!request.body) throw new ApplicationError("RECEIPT_CONTENT_MISMATCH", "Receipt content is not a valid supported image.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RECEIPT_BYTES || total > declaredLength) {
        await reader.cancel();
        throw new ApplicationError("RECEIPT_CONTENT_MISMATCH", "Receipt content is not a valid supported image.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== declaredLength) throw new ApplicationError("RECEIPT_CONTENT_MISMATCH", "Receipt content is not a valid supported image.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function runReceiptUpload(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) return json({ error: "Cross-origin requests are not permitted." }, 403);
  const declaredLength = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > MAX_RECEIPT_BYTES) {
    return json({ error: "Receipt content is not a valid supported image.", code: "RECEIPT_CONTENT_MISMATCH" }, 400);
  }
  try {
    const headers = parseUploadHeaders(request);
    const resolved = await resolveReadContext();
    if (resolved.status !== "ok") return resolved.status as NextResponse;
    if (!resolved.context.capabilities.receiptMutations) throw new ApplicationError("NOT_FOUND", "Receipt not found.");
    const bytes = await readBoundedReceiptBody(request, declaredLength);
    return json({ data: await resolved.context.receiptOperations.upload({ ...headers, bytes }) });
  } catch (error) {
    return mapReceiptRouteFailure(error);
  }
}

export async function runReceiptContentRead(
  request: NextRequest,
  receiptId: string,
): Promise<NextResponse> {
  if (request.headers.get("origin") && !sameOrigin(request)) {
    return json({ error: "Cross-origin requests are not permitted." }, 403);
  }
  try {
    if (!RESOURCE_ID_PATTERN.test(receiptId)) throw new ApplicationError("NOT_FOUND", "Receipt not found.");
    const resolved = await resolveReadContext();
    if (resolved.status !== "ok") return resolved.status as NextResponse;
    if (!resolved.context.capabilities.receiptContentReads) throw new ApplicationError("NOT_FOUND", "Receipt not found.");
    const content = await resolved.context.receiptOperations.read(receiptId);
    return new NextResponse(Buffer.from(content.bytes), {
      status: 200,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": "inline",
        "content-length": String(content.sizeBytes),
        "content-security-policy": "default-src 'none'; sandbox",
        "content-type": content.mimeType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return mapReceiptRouteFailure(error);
  }
}
