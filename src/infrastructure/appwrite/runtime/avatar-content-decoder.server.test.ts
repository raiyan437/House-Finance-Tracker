import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { decodeAvatarContentOnServer } from "./avatar-content-decoder.server";

async function image(format: "jpeg" | "png" | "webp", width = 2, height = 2): Promise<Uint8Array> {
  return new Uint8Array(await sharp({ create: { width, height, channels: 3, background: "#336699" } })[format]().toBuffer());
}

describe("trusted Profile avatar decoder", () => {
  it.each([["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"]] as const)("fully decodes valid %s content", async (format, mimeType) => {
    await expect(decodeAvatarContentOnServer({ bytes: await image(format), mimeType })).resolves.toBeUndefined();
  });

  it("rejects truncated, MIME-mismatched, and decompression-heavy images", async () => {
    const png = await image("png");
    await expect(decodeAvatarContentOnServer({ bytes: png.slice(0, -8), mimeType: "image/png" })).rejects.toMatchObject({ code: "AVATAR_CONTENT_MISMATCH" });
    await expect(decodeAvatarContentOnServer({ bytes: png, mimeType: "image/jpeg" })).rejects.toMatchObject({ code: "AVATAR_CONTENT_MISMATCH" });
    const tooManyPixels = await image("png", 8000, 6000);
    await expect(decodeAvatarContentOnServer({ bytes: tooManyPixels, mimeType: "image/png" })).rejects.toMatchObject({ code: "AVATAR_CONTENT_MISMATCH" });
  });
});
