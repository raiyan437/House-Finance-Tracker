import { ApplicationError } from "@/application/errors/application-error";
import type { ReceiptContent } from "@/application/repositories";
import { assertReceiptContentStructure } from "@/application/receipts/receipt-content-validation";
import { MAX_AVATAR_BYTES } from "@/domain/profile/avatar-policy";

export const AVATAR_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number];
export type AvatarContent = Readonly<{ bytes: Uint8Array; mimeType: AvatarMimeType }>;

export function invalidAvatarContent(): never {
  throw new ApplicationError(
    "AVATAR_CONTENT_MISMATCH",
    "Choose a valid JPEG, PNG or WebP image up to 5 MB.",
  );
}

export function isAvatarMimeType(value: string): value is AvatarMimeType {
  return (AVATAR_MIME_TYPES as readonly string[]).includes(value);
}

/** Reuses the proven Receipt structural parser under the stricter avatar size envelope. */
export function assertAvatarContentStructure(content: AvatarContent): void {
  if (
    !(content.bytes instanceof Uint8Array) ||
    content.bytes.byteLength < 1 ||
    content.bytes.byteLength > MAX_AVATAR_BYTES ||
    !isAvatarMimeType(content.mimeType)
  ) {
    invalidAvatarContent();
  }
  try {
    assertReceiptContentStructure(content as ReceiptContent);
  } catch {
    invalidAvatarContent();
  }
}
