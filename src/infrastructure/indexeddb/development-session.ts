import { ApplicationError } from "@/application/errors/application-error";
import type { CurrentSession, DevelopmentIdentityController } from "@/application/repositories";
import { userId, type UserId } from "@/domain/shared/identifiers";
import type { IDBPDatabase } from "idb";
import type { HouseFinanceDatabase } from "./records";

type DatabaseSource = IDBPDatabase<HouseFinanceDatabase> | Promise<IDBPDatabase<HouseFinanceDatabase>>;

export class LocalCurrentSession implements CurrentSession, DevelopmentIdentityController {
  private readonly listeners = new Set<(userId: UserId) => void>();

  constructor(private readonly source: DatabaseSource) {}

  private async db(): Promise<IDBPDatabase<HouseFinanceDatabase>> { return this.source; }

  async getCurrentUserId(): Promise<UserId> {
    const record = await (await this.db()).get("developmentSession", "current");
    if (!record || record.key !== "current") {
      throw new ApplicationError("SESSION_UNAVAILABLE", "No local development identity is selected.");
    }
    return userId(record.currentUserId);
  }

  async listIdentityIds(): Promise<readonly UserId[]> {
    const records = await (await this.db()).getAll("userProfiles");
    return Object.freeze(records.map((record) => userId(record.id)).sort());
  }

  async switchIdentity(nextUserId: UserId): Promise<void> {
    userId(nextUserId);
    const db = await this.db();
    if (!(await db.getKey("userProfiles", nextUserId))) {
      throw new ApplicationError("NOT_FOUND", "Development identity not found.");
    }
    await db.put("developmentSession", { key: "current", currentUserId: nextUserId });
    this.listeners.forEach((listener) => listener(nextUserId));
  }

  subscribe(listener: (userId: UserId) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
