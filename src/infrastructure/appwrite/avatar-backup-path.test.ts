import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveVerifiedAvatarBinaryPath } from "../../../scripts/avatar-backup-path";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hft-avatar-backup-"));
  roots.push(root);
  mkdirSync(join(root, "avatars"));
  writeFileSync(join(root, "avatars", "u_safe.bin"), "safe");
  return root;
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe("avatar backup path safety", () => {
  it("accepts only the canonical user-keyed avatar path", () => {
    const root = fixture();
    expect(resolveVerifiedAvatarBinaryPath(root, "u_safe", "avatars/u_safe.bin")).toBe(join(root, "avatars", "u_safe.bin"));
    expect(() => resolveVerifiedAvatarBinaryPath(root, "u_safe", "avatars/../outside.bin")).toThrow(/Unsafe avatar backup path/);
  });

  it("rejects symlinked avatar binaries", () => {
    const root = fixture();
    const external = join(root, "external.bin");
    writeFileSync(external, "private");
    rmSync(join(root, "avatars", "u_safe.bin"));
    try {
      symlinkSync(external, join(root, "avatars", "u_safe.bin"), "file");
    } catch {
      return;
    }
    expect(() => resolveVerifiedAvatarBinaryPath(root, "u_safe", "avatars/u_safe.bin")).toThrow(/Unsafe avatar backup path/);
  });
});
