"use client";

import "client-only";

import { HouseFinanceApplication, type ApplicationValues, type GeneratedIdKind } from "@/application/services/application-services";
import { isoInstant } from "@/domain/shared/instant";
import type { AtomicApplicationPersistence } from "@/application/repositories";
import type { IDBPDatabase } from "idb";
import { IndexedDbAtomicApplicationPersistence } from "./indexeddb/atomic-persistence";
import { deleteLocalDatabase, LOCAL_DATABASE_NAME, openLocalDatabase } from "./indexeddb/database";
import { LocalCurrentSession } from "./indexeddb/development-session";
import { IndexedDbRepositories } from "./indexeddb/repositories";
import type { HouseFinanceDatabase } from "./indexeddb/records";
import { initializeLocalDatabase } from "./indexeddb/seed";
import { sweepExpiredLocalReceiptContent } from "./receipt-retention-sweep";
import { decodeReceiptContentInBrowser } from "./browser/receipt-content-decoder";
import type { UserProfile } from "@/domain/records/domain-records";

export class LocalDevelopmentRuntime {
  private constructor(
    readonly databaseName: string,
    private connection: IDBPDatabase<HouseFinanceDatabase>,
    public repositories: IndexedDbRepositories,
    public atomicPersistence: AtomicApplicationPersistence,
    public currentSession: LocalCurrentSession,
    public application: HouseFinanceApplication,
  ) {}

  static async create(databaseName = LOCAL_DATABASE_NAME): Promise<LocalDevelopmentRuntime> {
    const connection = await openLocalDatabase(databaseName);
    try {
      await initializeLocalDatabase(connection);
    } catch (error) {
      connection.close();
      throw error;
    }
    const repositories = new IndexedDbRepositories(connection);
    const atomicPersistence = new IndexedDbAtomicApplicationPersistence(connection);
    const currentSession = new LocalCurrentSession(connection);

    // Owner-approved local retention enforcement: opportunistically expire
    // receipt content past the rolling three-calendar-month cutoff during
    // bootstrap. Privileged infrastructure work; no UI trigger or purge action.
    void sweepExpiredLocalReceiptContent(repositories.receipts);

    return new LocalDevelopmentRuntime(
      databaseName,
      connection,
      repositories,
      atomicPersistence,
      currentSession,
      new HouseFinanceApplication({ repositories, atomic: atomicPersistence, session: currentSession, values: new BrowserApplicationValues(), receiptContentDecoder: decodeReceiptContentInBrowser }),
    );
  }

  async listDevelopmentIdentities(): Promise<readonly UserProfile[]> {
    const identityIds = await this.currentSession.listIdentityIds();
    const profiles = await Promise.all(
      identityIds.map((identityId) => this.repositories.profiles.getById(identityId)),
    );

    return Object.freeze(
      profiles
        .filter((profile): profile is UserProfile => Boolean(profile))
        .sort((left, right) => left.displayName.localeCompare(right.displayName)),
    );
  }

  async resetAndReseed(): Promise<void> {
    this.connection.close();
    await deleteLocalDatabase(this.databaseName);
    this.connection = await openLocalDatabase(this.databaseName);
    await initializeLocalDatabase(this.connection);
    this.repositories = new IndexedDbRepositories(this.connection);
    this.atomicPersistence = new IndexedDbAtomicApplicationPersistence(this.connection);
    this.currentSession = new LocalCurrentSession(this.connection);
    this.application = new HouseFinanceApplication({ repositories: this.repositories, atomic: this.atomicPersistence, session: this.currentSession, values: new BrowserApplicationValues(), receiptContentDecoder: decodeReceiptContentInBrowser });
  }

  close(): void {
    this.connection.close();
  }
}

class BrowserApplicationValues implements ApplicationValues {
  now() { return isoInstant(new Date().toISOString()); }
  nextId(kind: GeneratedIdKind): string { return `${kind}-${crypto.randomUUID()}`; }
  nextHouseholdCodeCandidate(): string {
    const values = new Uint32Array(1);
    const unbiasedLimit = 4_000_000_000;
    let value: number;
    do {
      crypto.getRandomValues(values);
      value = values[0];
    } while (value >= unbiasedLimit);
    return String(value % 1_000_000_000).padStart(9, "0");
  }
}
