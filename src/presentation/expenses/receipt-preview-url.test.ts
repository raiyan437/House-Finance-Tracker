import { describe, expect, it, vi } from "vitest";

import { createTrackedReceiptPreviewUrl } from "./receipt-preview-url";

describe("receipt preview URL lifecycle", () => {
  it("does not create or retain an object URL when a delayed read resolves after unmount", async () => {
    let resolveRead!: (value: { bytes: Uint8Array; mimeType: "image/png" }) => void;
    const read = new Promise<{ bytes: Uint8Array; mimeType: "image/png" }>((resolve) => { resolveRead = resolve; });
    let current = true;
    const create = vi.spyOn(URL, "createObjectURL");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const track = vi.fn();
    const result = createTrackedReceiptPreviewUrl(() => read, () => current, track);

    current = false;
    resolveRead({ bytes: new Uint8Array([1]), mimeType: "image/png" });

    await expect(result).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });
});
