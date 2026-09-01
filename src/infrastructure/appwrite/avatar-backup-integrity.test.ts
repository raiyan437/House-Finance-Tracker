import { describe, expect, it } from "vitest";
import { assertAvatarBackupCoverage } from "../../../scripts/avatar-backup-integrity";

const profiles = [
  { $id: "u_with", avatarFileId: "avatar_private", avatarUpdatedAt: "2026-09-01T00:00:00.000Z" },
  { $id: "u_without", avatarFileId: null, avatarUpdatedAt: null },
];

describe("avatar backup manifest integrity", () => {
  it("requires exactly one user-keyed entry for every authoritative Profile pointer", () => {
    expect(() => assertAvatarBackupCoverage(profiles, [{ userId: "u_with" }])).not.toThrow();
    expect(() => assertAvatarBackupCoverage(profiles, [])).toThrow(/exactly one/);
    expect(() => assertAvatarBackupCoverage(profiles, [{ userId: "u_with" }, { userId: "u_with" }])).toThrow(/Duplicate/);
    expect(() => assertAvatarBackupCoverage(profiles, [{ userId: "u_without" }])).toThrow(/mapping mismatch/);
  });

  it("rejects incomplete, invalid, and non-avatar Profile pointers", () => {
    expect(() => assertAvatarBackupCoverage([{ $id: "u", avatarFileId: "receipt_wrong", avatarUpdatedAt: "2026-09-01T00:00:00Z" }], [])).toThrow(/invalid avatar/);
    expect(() => assertAvatarBackupCoverage([{ $id: "u", avatarFileId: "avatar_ok", avatarUpdatedAt: null }], [])).toThrow(/invalid avatar/);
    expect(() => assertAvatarBackupCoverage([{ $id: "u", avatarFileId: null, avatarUpdatedAt: "2026-09-01T00:00:00Z" }], [])).toThrow(/incomplete/);
  });
});
