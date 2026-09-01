export interface AvatarBackupEntryIdentity {
  readonly userId: string;
}

export function assertAvatarBackupCoverage(
  profileRows: readonly Record<string, unknown>[],
  entries: readonly AvatarBackupEntryIdentity[],
): void {
  const pointedProfiles = new Map<string, Record<string, unknown>>();
  for (const profile of profileRows) {
    const userId = String(profile.$id ?? "");
    const fileId = profile.avatarFileId;
    const updatedAt = profile.avatarUpdatedAt;
    if (typeof fileId === "string" && fileId.length > 0) {
      if (!userId || !fileId.startsWith("avatar_") || typeof updatedAt !== "string" || Number.isNaN(new Date(updatedAt).getTime())) {
        throw new Error(`Profile ${userId || "unknown"} has invalid avatar infrastructure.`);
      }
      pointedProfiles.set(userId, profile);
    } else if (updatedAt !== null && updatedAt !== undefined) {
      throw new Error(`Profile ${userId || "unknown"} has incomplete avatar infrastructure.`);
    }
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.userId)) throw new Error(`Duplicate avatar backup entry for ${entry.userId}.`);
    if (!pointedProfiles.has(entry.userId)) throw new Error(`Profile/avatar mapping mismatch for ${entry.userId}.`);
    seen.add(entry.userId);
  }
  if (seen.size !== pointedProfiles.size) throw new Error("Not every Profile avatar pointer has exactly one backed-up binary.");
}
