import "server-only";

import sharp from "sharp";
import { ApplicationError } from "@/application/errors/application-error";
import { assertReceiptContentStructure } from "@/application/receipts/receipt-content-validation";
import type { ReceiptContent } from "@/application/repositories";

// Pin Sharp's existing valid-image envelope explicitly while avoiding a full
// raw-pixel Buffer allocation. This preserves frozen R4 compatibility.
export const MAX_RECEIPT_DECODED_PIXELS = 268_402_689;

function invalidReceipt(): never {
  throw new ApplicationError("RECEIPT_CONTENT_MISMATCH", "Receipt content is not a valid supported image.");
}

export async function decodeReceiptContentOnServer(content: ReceiptContent): Promise<void> {
  assertReceiptContentStructure(content);
  try {
    const image = sharp(Buffer.from(content.bytes), { failOn: "error", sequentialRead: true, limitInputPixels: MAX_RECEIPT_DECODED_PIXELS });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width < 1 || metadata.height < 1) invalidReceipt();
    if (metadata.width * metadata.height > MAX_RECEIPT_DECODED_PIXELS) invalidReceipt();
    const expected = content.mimeType === "image/jpeg" ? "jpeg" : content.mimeType.slice("image/".length);
    if (metadata.format !== expected) invalidReceipt();
    await image.clone().stats();
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    invalidReceipt();
  }
}
