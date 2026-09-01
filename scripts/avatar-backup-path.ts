import { lstatSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const USER_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;

export function resolveVerifiedAvatarBinaryPath(root: string, userId: string, relativePath: string): string {
  if (!USER_ID_PATTERN.test(userId) || relativePath !== `avatars/${userId}.bin`) {
    throw new Error(`Unsafe avatar backup path for ${userId}.`);
  }
  const avatarDirectory = join(root, "avatars");
  const candidate = resolve(root, relativePath);
  const fromRoot = relative(resolve(root), candidate);
  if (fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || fromRoot.includes(`..${sep}`)) {
    throw new Error(`Unsafe avatar backup path for ${userId}.`);
  }
  const stats = lstatSync(candidate);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Unsafe avatar backup path for ${userId}.`);
  const realDirectory = realpathSync(avatarDirectory);
  const realCandidate = realpathSync(candidate);
  if (relative(realDirectory, realCandidate).startsWith("..")) throw new Error(`Unsafe avatar backup path for ${userId}.`);
  return candidate;
}
