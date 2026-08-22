interface ReceiptPreviewContent {
  readonly bytes: Uint8Array;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
}

function receiptBlob(bytes: Uint8Array, type: string): Blob {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type });
}

export async function createTrackedReceiptPreviewUrl(
  read: () => Promise<ReceiptPreviewContent>,
  isCurrent: () => boolean,
  track: (url: string) => void,
): Promise<string | undefined> {
  const content = await read();
  if (!isCurrent()) return undefined;
  const url = URL.createObjectURL(receiptBlob(content.bytes, content.mimeType));
  if (!isCurrent()) {
    URL.revokeObjectURL(url);
    return undefined;
  }
  track(url);
  return url;
}
