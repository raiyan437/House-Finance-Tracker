import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { decodeReceiptContentOnServer } from "./receipt-content-decoder.server";

async function image(format: "jpeg" | "png" | "webp"): Promise<Uint8Array> {
  const pipeline = sharp({
    create: { width: 2, height: 2, channels: 3, background: "#336699" },
  });
  return new Uint8Array(await pipeline[format]().toBuffer());
}

describe("trusted Receipt image decoder", () => {
  it.each([
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ] as const)("fully decodes valid %s content", async (format, mimeType) => {
    await expect(decodeReceiptContentOnServer({ bytes: await image(format), mimeType })).resolves.toBeUndefined();
  });

  it("rejects signature-only, truncated, corrupt, and contradictory content", async () => {
    const png = await image("png");
    await expect(decodeReceiptContentOnServer({ bytes: png.slice(0, 8), mimeType: "image/png" }))
      .rejects.toMatchObject({ code: "RECEIPT_CONTENT_MISMATCH" });
    await expect(decodeReceiptContentOnServer({ bytes: png.slice(0, -8), mimeType: "image/png" }))
      .rejects.toMatchObject({ code: "RECEIPT_CONTENT_MISMATCH" });
    const corrupt = png.slice();
    corrupt[Math.floor(corrupt.length / 2)] ^= 0xff;
    await expect(decodeReceiptContentOnServer({ bytes: corrupt, mimeType: "image/png" }))
      .rejects.toMatchObject({ code: "RECEIPT_CONTENT_MISMATCH" });
    await expect(decodeReceiptContentOnServer({ bytes: png, mimeType: "image/jpeg" }))
      .rejects.toMatchObject({ code: "RECEIPT_CONTENT_MISMATCH" });
  });
});
