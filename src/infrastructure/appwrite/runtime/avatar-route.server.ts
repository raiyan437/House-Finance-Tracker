import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { ApplicationError } from "@/application/errors/application-error";
import { serializeWithBigInt } from "@/application/transport/json-bigint";
import { isAvatarMimeType, type AvatarMimeType } from "@/application/profile/avatar-content-validation";
import { MAX_AVATAR_BYTES } from "@/domain/profile/avatar-policy";
import { assertSameOrigin, mapReadError, resolveReadContext } from "./read-route.server";
import { TransactionFailure } from "./tx-errors.server";

const JSON_HEADERS = { "cache-control": "no-store", "content-type": "application/json" } as const;
const COMMAND_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/u;
const USER_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;

function json(data: unknown, status = 200): NextResponse {
  return new NextResponse(serializeWithBigInt(data), { status, headers: JSON_HEADERS });
}

function mapAvatarFailure(error: unknown): NextResponse {
  if (error instanceof TransactionFailure) {
    return json({
      error: error.kind === "conflict"
        ? "This Profile changed while you were editing it."
        : "The service is temporarily busy. Please retry shortly.",
      ...(error.kind === "conflict" ? { code: "PROFILE_VERSION_CONFLICT" } : {}),
    }, error.kind === "conflict" ? 409 : 503);
  }
  const mapped = mapReadError(error);
  if (mapped) return json(mapped.body, mapped.status);
  console.error("[avatar-route]", error instanceof Error ? error.message : error);
  return json({ error: "The service is temporarily unavailable." }, 503);
}

export async function readBoundedAvatarBody(request: NextRequest, declaredLength: number): Promise<Uint8Array> {
  if (!request.body) throw new ApplicationError("AVATAR_CONTENT_MISMATCH", "Choose a valid JPEG, PNG or WebP image up to 5 MB.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AVATAR_BYTES || total > declaredLength) {
        await reader.cancel();
        throw new ApplicationError("AVATAR_CONTENT_MISMATCH", "Choose a valid JPEG, PNG or WebP image up to 5 MB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== declaredLength || total < 1) {
    throw new ApplicationError("AVATAR_CONTENT_MISMATCH", "Choose a valid JPEG, PNG or WebP image up to 5 MB.");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function runAvatarRead(request: NextRequest): Promise<NextResponse> {
  try {
    if (request.headers.get("origin") && !assertSameOrigin(request, false)) {
      return json({ error: "Cross-origin requests are not permitted." }, 403);
    }
    const targetUserId = new URL(request.url).searchParams.get("userId")?.trim() ?? "";
    if (!USER_ID_PATTERN.test(targetUserId)) throw new ApplicationError("NOT_FOUND", "Profile picture not found.");
    const resolved = await resolveReadContext();
    if (resolved.status !== "ok") return resolved.status as NextResponse;
    if (!resolved.context.capabilities.avatarContentReads) throw new ApplicationError("NOT_FOUND", "Profile picture not found.");
    const content = await resolved.context.avatarOperations.read(targetUserId);
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
    return mapAvatarFailure(error);
  }
}

export async function runAvatarReplace(request: NextRequest): Promise<NextResponse> {
  try {
    if (!assertSameOrigin(request)) return json({ error: "Cross-origin requests are not permitted." }, 403);
    const commandId = request.headers.get("x-command-id")?.trim() ?? "";
    const expectedProfileVersion = Number(request.headers.get("x-profile-version"));
    const mimeType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    const declaredLength = Number(request.headers.get("content-length"));
    if (!COMMAND_ID_PATTERN.test(commandId) || !Number.isSafeInteger(expectedProfileVersion) || expectedProfileVersion < 1) {
      throw new ApplicationError("INVALID_INPUT", "The profile picture request is invalid.");
    }
    if (!isAvatarMimeType(mimeType) || !Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > MAX_AVATAR_BYTES) {
      throw new ApplicationError("AVATAR_CONTENT_MISMATCH", "Choose a valid JPEG, PNG or WebP image up to 5 MB.");
    }
    const resolved = await resolveReadContext();
    if (resolved.status !== "ok") return resolved.status as NextResponse;
    if (!resolved.context.capabilities.avatarMutations) throw new ApplicationError("NOT_FOUND", "Profile picture not found.");
    const bytes = await readBoundedAvatarBody(request, declaredLength);
    return json({ data: await resolved.context.avatarOperations.replace({
      commandId,
      expectedProfileVersion,
      mimeType: mimeType as AvatarMimeType,
      bytes,
    }) });
  } catch (error) {
    return mapAvatarFailure(error);
  }
}
