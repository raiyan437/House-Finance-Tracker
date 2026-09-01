import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { MAX_AVATAR_BYTES } from "@/domain/profile/avatar-policy";
import { assertAvatarContentStructure } from "./avatar-content-validation";

const JPEG = new Uint8Array(Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEABj8Cf//Z", "base64"));

function jpegAtSize(source: Uint8Array, targetSize: number): Uint8Array {
  const output = new Uint8Array(targetSize);
  output.set(source.slice(0, 2), 0);
  let offset = 2;
  let remaining = targetSize - source.byteLength;
  while (remaining > 0) {
    let total = Math.min(65_537, remaining);
    const leftover = remaining - total;
    if (leftover > 0 && leftover < 4) total -= 4 - leftover;
    const payload = total - 4;
    output[offset] = 0xff;
    output[offset + 1] = 0xe2;
    output[offset + 2] = (payload + 2) >>> 8;
    output[offset + 3] = (payload + 2) & 0xff;
    offset += total;
    remaining -= total;
  }
  output.set(source.slice(2), offset);
  return output;
}

describe("Profile avatar structural validation", () => {
  it("accepts exactly 5 MiB and rejects one byte beyond", { timeout: 15_000 }, () => {
    expect(() => assertAvatarContentStructure({ bytes: jpegAtSize(JPEG, MAX_AVATAR_BYTES), mimeType: "image/jpeg" })).not.toThrow();
    expect(() => assertAvatarContentStructure({ bytes: jpegAtSize(JPEG, MAX_AVATAR_BYTES + 1), mimeType: "image/jpeg" }))
      .toThrowError(expect.objectContaining({ code: "AVATAR_CONTENT_MISMATCH" }));
  });

  it("rejects zero-byte, truncated, malformed, and MIME-mismatched content", () => {
    const values = [
      { bytes: new Uint8Array(), mimeType: "image/jpeg" as const },
      { bytes: JPEG.slice(0, -2), mimeType: "image/jpeg" as const },
      { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" as const },
      { bytes: JPEG, mimeType: "image/webp" as const },
    ];
    for (const value of values) {
      expect(() => assertAvatarContentStructure(value)).toThrowError(expect.objectContaining({ code: "AVATAR_CONTENT_MISMATCH" }));
    }
  });
});
