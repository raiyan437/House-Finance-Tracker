import { ApplicationError } from "@/application/errors/application-error";
import type { ReceiptContent } from "@/application/repositories";

function invalidReceipt(): ApplicationError {
  return new ApplicationError(
    "RECEIPT_CONTENT_MISMATCH",
    "Receipt content is not a valid supported image.",
  );
}

function receiptBlob(content: ReceiptContent): Blob {
  const bytes = new Uint8Array(content.bytes.byteLength);
  bytes.set(content.bytes);
  return new Blob([bytes.buffer], { type: content.mimeType });
}

export async function decodeReceiptContentInBrowser(content: ReceiptContent): Promise<void> {
  const blob = receiptBlob(content);
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(blob);
      try {
        if (bitmap.width < 1 || bitmap.height < 1) throw invalidReceipt();
      } finally {
        bitmap.close();
      }
      return;
    }

    if (typeof Image !== "function" || typeof URL?.createObjectURL !== "function") {
      throw invalidReceipt();
    }
    const url = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          if (image.naturalWidth < 1 || image.naturalHeight < 1) reject(invalidReceipt());
          else resolve();
        };
        image.onerror = () => reject(invalidReceipt());
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw invalidReceipt();
  }
}
