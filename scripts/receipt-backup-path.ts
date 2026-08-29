import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const RECEIPT_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;

function escapes(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
}

export function resolveVerifiedReceiptBinaryPath(rootDirectory: string, receiptId: string, relativePath: string): string {
  if (!RECEIPT_ID_PATTERN.test(receiptId) || relativePath !== `receipts/${receiptId}.bin`) {
    throw new Error(`Unsafe Receipt backup path for ${receiptId}.`);
  }
  const root = resolve(rootDirectory);
  const receiptDirectory = join(root, "receipts");
  const candidate = join(receiptDirectory, `${receiptId}.bin`);
  if (escapes(root, candidate) || lstatSync(receiptDirectory).isSymbolicLink() || lstatSync(candidate).isSymbolicLink()) {
    throw new Error(`Unsafe Receipt backup path for ${receiptId}.`);
  }
  const realRoot = realpathSync(root);
  const realCandidate = realpathSync(candidate);
  if (escapes(realRoot, realCandidate)) throw new Error(`Unsafe Receipt backup path for ${receiptId}.`);
  return candidate;
}
