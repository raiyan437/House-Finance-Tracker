import "server-only";

import { Query, type Models, type Storage } from "node-appwrite";
import { InputFile } from "node-appwrite/file";
import { createHash } from "node:crypto";
import { BUCKET_ID } from "../schema/definitions";
import { isProviderNotFound, normalizedProviderFailure } from "../reads/provider-errors.server";

export interface PrivateStorageFile {
  readonly id: string;
  readonly sizeBytes: number;
  readonly mimeType: string;
  readonly createdAt: string;
}

export interface PrivateImageStoragePort {
  create(fileId: string, bytes: Uint8Array, filename: string): Promise<PrivateStorageFile>;
  get(fileId: string): Promise<PrivateStorageFile | undefined>;
  read(fileId: string): Promise<Uint8Array | undefined>;
  remove(fileId: string): Promise<"deleted" | "missing">;
  list(cursor?: string, limit?: number): Promise<readonly PrivateStorageFile[]>;
}

export type ReceiptStorageFile = PrivateStorageFile;
export type ReceiptStoragePort = PrivateImageStoragePort;

function mapFile(file: Models.File): PrivateStorageFile {
  return Object.freeze({ id: file.$id, sizeBytes: file.sizeOriginal, mimeType: file.mimeType, createdAt: file.$createdAt });
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class AppwritePrivateImageStorage implements PrivateImageStoragePort {
  constructor(private readonly storage: Storage) {}

  async create(fileId: string, bytes: Uint8Array, filename: string): Promise<PrivateStorageFile> {
    try {
      const file = await this.storage.createFile({
        bucketId: BUCKET_ID,
        fileId,
        file: InputFile.fromBuffer(Buffer.from(bytes), filename),
        permissions: [],
      });
      return mapFile(file);
    } catch (error) {
      throw normalizedProviderFailure(error);
    }
  }

  async get(fileId: string): Promise<PrivateStorageFile | undefined> {
    try {
      return mapFile(await this.storage.getFile({ bucketId: BUCKET_ID, fileId }));
    } catch (error) {
      if (isProviderNotFound(error)) return undefined;
      throw normalizedProviderFailure(error);
    }
  }

  async read(fileId: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await this.storage.getFileDownload({ bucketId: BUCKET_ID, fileId }));
    } catch (error) {
      if (isProviderNotFound(error)) return undefined;
      throw normalizedProviderFailure(error);
    }
  }

  async remove(fileId: string): Promise<"deleted" | "missing"> {
    try {
      await this.storage.deleteFile({ bucketId: BUCKET_ID, fileId });
      return "deleted";
    } catch (error) {
      if (isProviderNotFound(error)) return "missing";
      throw normalizedProviderFailure(error);
    }
  }

  async list(cursor?: string, limit = 25): Promise<readonly PrivateStorageFile[]> {
    try {
      const queries = [Query.orderAsc("$createdAt"), Query.orderAsc("$id"), Query.limit(limit)];
      const result = await this.storage.listFiles({ bucketId: BUCKET_ID, queries: cursor ? [...queries, Query.cursorAfter(cursor)] : queries });
      return result.files.map(mapFile);
    } catch (error) {
      throw normalizedProviderFailure(error);
    }
  }
}

export class AppwriteReceiptStorage extends AppwritePrivateImageStorage {}
