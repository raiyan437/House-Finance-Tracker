import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveVerifiedReceiptBinaryPath } from "../../../scripts/receipt-backup-path";

const roots: string[] = [];

function backupRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hft-receipt-backup-"));
  roots.push(root);
  mkdirSync(join(root, "receipts"));
  writeFileSync(join(root, "receipts", "r_safe.bin"), "safe");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Receipt backup binary paths", () => {
  it("accepts only the exact canonical path inside the backup", () => {
    const root = backupRoot();
    expect(resolveVerifiedReceiptBinaryPath(root, "r_safe", "receipts/r_safe.bin"))
      .toBe(join(root, "receipts", "r_safe.bin"));
  });

  it.each([
    "../outside.bin",
    "receipts/../outside.bin",
    "receipts\\r_safe.bin",
    "/receipts/r_safe.bin",
    "receipts/r_other.bin",
  ])("rejects non-canonical manifest path %s", (relativePath) => {
    const root = backupRoot();
    expect(() => resolveVerifiedReceiptBinaryPath(root, "r_safe", relativePath)).toThrow("Unsafe Receipt backup path");
  });

  it("rejects a symbolic-link binary", () => {
    const root = backupRoot();
    const external = join(root, "external.bin");
    writeFileSync(external, "external");
    rmSync(join(root, "receipts", "r_safe.bin"));
    try {
      symlinkSync(external, join(root, "receipts", "r_safe.bin"), "file");
    } catch {
      return;
    }
    expect(() => resolveVerifiedReceiptBinaryPath(root, "r_safe", "receipts/r_safe.bin")).toThrow("Unsafe Receipt backup path");
  });
});
