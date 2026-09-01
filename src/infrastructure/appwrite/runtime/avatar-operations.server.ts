import "server-only";

import { Query, type TablesDB } from "node-appwrite";
import { z } from "zod";
import { ApplicationError } from "@/application/errors/application-error";
import { canonicalIntentDigest } from "@/application/idempotency/command-idempotency";
import { isAvatarMimeType, type AvatarMimeType } from "@/application/profile/avatar-content-validation";
import { MAX_AVATAR_BYTES } from "@/domain/profile/avatar-policy";
import type { UserId } from "@/domain/shared/identifiers";
import { isoInstant } from "@/domain/shared/instant";
import { avatarStorageFileId, commandOutcomeRowId, isAvatarStorageFileId } from "../ids";
import { mapMembership } from "../reads/mappers.server";
import { createTablesReader, type AppwriteRow, type TablesReader } from "../reads/tables.server";
import { decodeAvatarContentOnServer } from "./avatar-content-decoder.server";
import type { PrivateImageStoragePort } from "./receipt-storage.server";
import { sha256Bytes } from "./receipt-storage.server";
import { runCommandTransaction, type CommandTransaction } from "./tx-runner.server";

const TABLE = {
  profiles: "profiles",
  memberships: "memberships",
  outcomes: "command_outcomes",
} as const;
const COMMAND_TYPE = "replace-profile-avatar";

const privateProfileSchema = z.object({
  version: z.number().int().min(1),
  avatarFileId: z.string().optional().nullable(),
  avatarUpdatedAt: z.string().optional().nullable(),
}).passthrough();

export interface AvatarReplacementInput {
  readonly commandId: string;
  readonly expectedProfileVersion: number;
  readonly mimeType: AvatarMimeType;
  readonly bytes: Uint8Array;
}

export interface AvatarReplacementResult {
  readonly profileVersion: number;
  readonly avatarUpdatedAt: string;
}

export interface AvatarBinaryResult {
  readonly bytes: Uint8Array;
  readonly mimeType: AvatarMimeType;
  readonly sizeBytes: number;
}

function genericAvatarFilename(mimeType: AvatarMimeType): string {
  return `avatar.${mimeType === "image/jpeg" ? "jpg" : mimeType.slice("image/".length)}`;
}

function parsePrivateProfile(raw: AppwriteRow | undefined): Readonly<{ version: number; avatarFileId?: string; avatarUpdatedAt?: string }> {
  if (!raw) throw new ApplicationError("NOT_FOUND", "Profile picture not found.");
  try {
    const value = privateProfileSchema.parse(raw);
    const avatarFileId = value.avatarFileId || undefined;
    const parsedAvatarInstant = value.avatarUpdatedAt ? new Date(value.avatarUpdatedAt) : undefined;
    if (parsedAvatarInstant && Number.isNaN(parsedAvatarInstant.getTime())) throw new Error("Invalid avatar timestamp.");
    const avatarUpdatedAt = parsedAvatarInstant ? isoInstant(parsedAvatarInstant.toISOString()) : undefined;
    if (Boolean(avatarFileId) !== Boolean(avatarUpdatedAt)) throw new Error("Incomplete avatar pointer.");
    if (avatarFileId && !isAvatarStorageFileId(avatarFileId)) throw new Error("Invalid avatar resource class.");
    return { version: value.version, ...(avatarFileId ? { avatarFileId, avatarUpdatedAt } : {}) };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("PERSISTENCE_FAILURE", "Profile picture data is unavailable.");
  }
}

export class AvatarOperations {
  constructor(
    private readonly tablesDB: TablesDB,
    private readonly storage: PrivateImageStoragePort,
    private readonly actorId: UserId,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private tables(tx?: CommandTransaction): TablesReader {
    return createTablesReader(this.tablesDB, tx ? { transactionId: tx.id } : undefined);
  }

  private async authorizeRead(tables: TablesReader, targetUserId: string): Promise<ReturnType<typeof parsePrivateProfile>> {
    const target = parsePrivateProfile(await tables.getRow(TABLE.profiles, targetUserId));
    if (targetUserId === String(this.actorId)) return target;
    const [actorMemberships, targetMemberships] = await Promise.all([
      tables.listRows(TABLE.memberships, [Query.equal("userId", String(this.actorId)), Query.equal("status", "active")]),
      tables.listRows(TABLE.memberships, [Query.equal("userId", targetUserId), Query.equal("status", "active")]),
    ]);
    const actorHouseholds = new Set(actorMemberships.map(mapMembership).map((membership) => String(membership.householdId)));
    const related = targetMemberships.map(mapMembership).some((membership) => actorHouseholds.has(String(membership.householdId)));
    if (!related) throw new ApplicationError("NOT_FOUND", "Profile picture not found.");
    return target;
  }

  private async committedOutcome(commandId: string, intentDigest: string): Promise<boolean> {
    const row = await this.tables().getRow(TABLE.outcomes, commandOutcomeRowId({ actorId: String(this.actorId), commandType: COMMAND_TYPE, commandId }));
    if (!row) return false;
    if (String(row.intentDigest) !== intentDigest) {
      throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "This command ID was already used for a different profile picture.");
    }
    return true;
  }

  private async currentResult(): Promise<AvatarReplacementResult> {
    const current = parsePrivateProfile(await this.tables().getRow(TABLE.profiles, String(this.actorId)));
    if (!current.avatarUpdatedAt) throw new ApplicationError("PERSISTENCE_FAILURE", "Profile picture state is unavailable.");
    return Object.freeze({ profileVersion: current.version, avatarUpdatedAt: current.avatarUpdatedAt });
  }

  private async cleanupUnreferenced(fileId: string): Promise<void> {
    const current = parsePrivateProfile(await this.tables().getRow(TABLE.profiles, String(this.actorId)));
    if (current.avatarFileId !== fileId) await this.storage.remove(fileId).catch(() => undefined);
  }

  async read(targetUserId: string): Promise<AvatarBinaryResult> {
    const authorized = await this.authorizeRead(this.tables(), targetUserId);
    if (!authorized.avatarFileId) throw new ApplicationError("NOT_FOUND", "Profile picture not found.");
    const [file, bytes] = await Promise.all([
      this.storage.get(authorized.avatarFileId),
      this.storage.read(authorized.avatarFileId),
    ]);
    if (!file || !bytes || bytes.byteLength < 1 || bytes.byteLength > MAX_AVATAR_BYTES || file.sizeBytes !== bytes.byteLength || !isAvatarMimeType(file.mimeType)) {
      throw new ApplicationError("NOT_FOUND", "Profile picture not found.");
    }
    const current = await this.authorizeRead(this.tables(), targetUserId);
    if (current.avatarFileId !== authorized.avatarFileId) throw new ApplicationError("NOT_FOUND", "Profile picture not found.");
    return Object.freeze({ bytes, mimeType: file.mimeType, sizeBytes: bytes.byteLength });
  }

  async replace(input: AvatarReplacementInput): Promise<AvatarReplacementResult> {
    const profile = parsePrivateProfile(await this.tables().getRow(TABLE.profiles, String(this.actorId)));
    if (!Number.isSafeInteger(input.expectedProfileVersion) || input.expectedProfileVersion < 1 || !isAvatarMimeType(input.mimeType)) {
      throw new ApplicationError("INVALID_INPUT", "The profile picture request is invalid.");
    }
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1 || input.bytes.byteLength > MAX_AVATAR_BYTES) {
      throw new ApplicationError("AVATAR_CONTENT_MISMATCH", "Choose a valid JPEG, PNG or WebP image up to 5 MB.");
    }
    const checksum = sha256Bytes(input.bytes);
    const intentDigest = canonicalIntentDigest({
      expectedProfileVersion: input.expectedProfileVersion,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      checksum,
    });
    if (await this.committedOutcome(input.commandId, intentDigest)) return this.currentResult();
    if (profile.version !== input.expectedProfileVersion) {
      throw new ApplicationError("PROFILE_VERSION_CONFLICT", "This Profile changed while you were editing it.");
    }
    await decodeAvatarContentOnServer({ bytes: input.bytes, mimeType: input.mimeType });

    const fileId = avatarStorageFileId(String(this.actorId), input.commandId);
    const existingBytes = await this.storage.read(fileId);
    if (existingBytes) {
      if (existingBytes.byteLength !== input.bytes.byteLength || sha256Bytes(existingBytes) !== checksum) {
        throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "This command ID was already used for a different profile picture.");
      }
    } else {
      try {
        await this.storage.create(fileId, input.bytes, genericAvatarFilename(input.mimeType));
      } catch (error) {
        const recovered = await this.storage.read(fileId).catch(() => undefined);
        if (!recovered || recovered.byteLength !== input.bytes.byteLength || sha256Bytes(recovered) !== checksum) throw error;
      }
    }

    const completedAt = this.now();
    try {
      await runCommandTransaction(this.tablesDB, async ({ tx }) => {
        const tables = this.tables(tx);
        const outcomeId = commandOutcomeRowId({ actorId: String(this.actorId), commandType: COMMAND_TYPE, commandId: input.commandId });
        const existingOutcome = await tables.getRow(TABLE.outcomes, outcomeId);
        if (existingOutcome) {
          if (String(existingOutcome.intentDigest) !== intentDigest) {
            throw new ApplicationError("IDEMPOTENCY_KEY_REUSED", "This command ID was already used for a different profile picture.");
          }
          return;
        }
        const current = parsePrivateProfile(await tables.getRow(TABLE.profiles, String(this.actorId)));
        if (current.version !== input.expectedProfileVersion) {
          throw new ApplicationError("PROFILE_VERSION_CONFLICT", "This Profile changed while you were editing it.");
        }
        await this.tablesDB.updateRow({
          databaseId: "hft",
          tableId: TABLE.profiles,
          rowId: String(this.actorId),
          data: { avatarFileId: fileId, avatarUpdatedAt: completedAt, version: current.version + 1, updatedAt: completedAt },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
        await this.tablesDB.createRow({
          databaseId: "hft",
          tableId: TABLE.outcomes,
          rowId: outcomeId,
          data: { actorId: this.actorId, commandType: COMMAND_TYPE, commandId: input.commandId, intentDigest, resourceId: String(this.actorId), completedAt },
          transactionId: tx.id,
        });
        tx.recordStagedOperation();
      });
    } catch (error) {
      if (await this.committedOutcome(input.commandId, intentDigest).catch(() => false)) return this.currentResult();
      await this.cleanupUnreferenced(fileId);
      throw error;
    }

    if (profile.avatarFileId && profile.avatarFileId !== fileId) {
      await this.storage.remove(profile.avatarFileId).catch(() => undefined);
    }
    return this.currentResult();
  }
}
