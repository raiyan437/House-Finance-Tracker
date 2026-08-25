import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import type { ReceiptContent } from "@/application/repositories";
import { MAX_RECEIPT_BYTES } from "@/domain/records/domain-records";
import {
  assertReceiptContentStructure,
  validateReceiptContent,
} from "./receipt-content-validation";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const JPEG_BASE64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/AP/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEABj8Cf//Z";
const WEBP_BASE64 = "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89";

function bytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

const fixtures = {
  "image/png": bytes(PNG_BASE64),
  "image/jpeg": bytes(JPEG_BASE64),
  "image/webp": bytes(WEBP_BASE64),
} as const;

function content(
  mimeType: keyof typeof fixtures,
  value = fixtures[mimeType],
): ReceiptContent {
  return { bytes: value, mimeType };
}

function jpegAtSize(source: Uint8Array, targetSize: number): Uint8Array {
  const paddingSize = targetSize - source.byteLength;
  if (paddingSize < 0) throw new Error("Target is smaller than the JPEG fixture.");
  const segments: number[] = [];
  let remaining = paddingSize;
  while (remaining > 0) {
    if (remaining < 4) throw new Error("JPEG padding cannot encode the requested remainder.");
    let total = Math.min(65_537, remaining);
    const leftover = remaining - total;
    if (leftover > 0 && leftover < 4) total -= 4 - leftover;
    const payloadSize = total - 4;
    const segmentLength = payloadSize + 2;
    segments.push(0xff, 0xe2, segmentLength >>> 8, segmentLength & 0xff);
    for (let index = 0; index < payloadSize; index += 1) segments.push(0);
    remaining -= total;
  }
  return new Uint8Array([source[0]!, source[1]!, ...segments, ...source.slice(2)]);
}

describe("receipt content validation", () => {
  it.each(Object.entries(fixtures))("accepts a complete valid %s image", (mimeType, value) => {
    expect(() => assertReceiptContentStructure({
      bytes: value,
      mimeType: mimeType as ReceiptContent["mimeType"],
    })).not.toThrow();
  });

  it.each(Object.entries(fixtures))("rejects a truncated %s image", (mimeType, value) => {
    expect(() => assertReceiptContentStructure({
      bytes: value.slice(0, Math.max(1, value.byteLength - 5)),
      mimeType: mimeType as ReceiptContent["mimeType"],
    })).toThrowError(expect.objectContaining({ code: "RECEIPT_CONTENT_MISMATCH" }));
  });

  it("rejects signature-only and malformed container structures", () => {
    const signatureOnly = [
      content("image/png", fixtures["image/png"].slice(0, 8)),
      content("image/jpeg", fixtures["image/jpeg"].slice(0, 3)),
      content("image/webp", fixtures["image/webp"].slice(0, 12)),
    ];
    for (const value of signatureOnly) {
      expect(() => assertReceiptContentStructure(value)).toThrowError(
        expect.objectContaining({ code: "RECEIPT_CONTENT_MISMATCH" }),
      );
    }

    const badPngCrc = fixtures["image/png"].slice();
    badPngCrc[29] ^= 0xff;
    expect(() => assertReceiptContentStructure(content("image/png", badPngCrc))).toThrow();

    const missingJpegEnd = fixtures["image/jpeg"].slice(0, -2);
    expect(() => assertReceiptContentStructure(content("image/jpeg", missingJpegEnd))).toThrow();

    const badWebpLength = fixtures["image/webp"].slice();
    badWebpLength[4] = 0;
    expect(() => assertReceiptContentStructure(content("image/webp", badWebpLength))).toThrow();
  });

  it("rejects supported MIME declarations that do not match the actual image", () => {
    expect(() => assertReceiptContentStructure({
      bytes: fixtures["image/png"],
      mimeType: "image/jpeg",
    })).toThrowError(expect.objectContaining({ code: "RECEIPT_CONTENT_MISMATCH" }));
  });

  // Generating and scanning two ~10 MiB JPEG fixtures can exceed the default
  // 5 s budget on a cold, single-file-parallelism run; the assertion itself is
  // fast once the fixtures exist.
  it("accepts the exact 10 MiB boundary and rejects one byte over", { timeout: 20_000 }, () => {
    const maximum = jpegAtSize(fixtures["image/jpeg"], MAX_RECEIPT_BYTES);
    expect(maximum).toHaveLength(MAX_RECEIPT_BYTES);
    expect(() => assertReceiptContentStructure(content("image/jpeg", maximum))).not.toThrow();

    const overMaximum = jpegAtSize(fixtures["image/jpeg"], MAX_RECEIPT_BYTES + 1);
    expect(() => assertReceiptContentStructure(content("image/jpeg", overMaximum))).toThrowError(
      expect.objectContaining({ code: "RECEIPT_CONTENT_MISMATCH" }),
    );
  });

  it("runs optional browser decoding only after structural validation", async () => {
    const decoder = vi.fn(async () => undefined);
    await expect(validateReceiptContent(content("image/png"), decoder)).resolves.toBeUndefined();
    expect(decoder).toHaveBeenCalledOnce();

    decoder.mockClear();
    await expect(validateReceiptContent(
      content("image/png", fixtures["image/png"].slice(0, 8)),
      decoder,
    )).rejects.toMatchObject({ code: "RECEIPT_CONTENT_MISMATCH" });
    expect(decoder).not.toHaveBeenCalled();
  });
});
