import "server-only";

import sharp from "sharp";
import { assertAvatarContentStructure, invalidAvatarContent, type AvatarContent } from "@/application/profile/avatar-content-validation";

// Bounds decompression work independently of the 5 MiB encoded-file limit.
export const MAX_AVATAR_DECODED_PIXELS = 40_000_000;

export async function decodeAvatarContentOnServer(content: AvatarContent): Promise<void> {
  assertAvatarContentStructure(content);
  try {
    const image = sharp(Buffer.from(content.bytes), {
      failOn: "error",
      sequentialRead: true,
      limitInputPixels: MAX_AVATAR_DECODED_PIXELS,
    });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_AVATAR_DECODED_PIXELS) {
      invalidAvatarContent();
    }
    const expected = content.mimeType === "image/jpeg" ? "jpeg" : content.mimeType.slice("image/".length);
    if (metadata.format !== expected) invalidAvatarContent();
    await image.clone().stats();
  } catch {
    invalidAvatarContent();
  }
}
