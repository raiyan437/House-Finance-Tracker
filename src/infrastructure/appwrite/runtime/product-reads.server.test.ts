import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRODUCTION_R4_CAPABILITIES } from "@/application/runtime-capabilities";
import { HouseFinanceApplication } from "@/application/services/application-services";
import type { ApplicationRepositories, AtomicApplicationPersistence, CurrentSession } from "@/application/repositories";
import type { ApplicationValues } from "@/application/services/application-services";
import { businessDateAt } from "@/domain/dates/business-calendar";
import { isoInstant, type IsoInstant } from "@/domain/shared/instant";
import type { UserId } from "@/domain/shared/identifiers";
import { InMemoryTablesReader } from "../reads/in-memory-tables-reader.helper";
import { loadBootstrap, loadBusinessDate } from "./product-reads.server";
import { buildProductRequestContext } from "./context.server";

const NOW = isoInstant("2026-08-26T18:30:00.000Z");
const SEED_INSTANT_ISO = "2026-08-01T00:00:00.000Z" as IsoInstant;

beforeEach(() => {
  // Hermetic configuration for client construction only (no network happens).
  vi.stubEnv("HFT_APPWRITE_ENDPOINT", "https://cloud.appwrite.io/v1");
  vi.stubEnv("HFT_APPWRITE_PROJECT_ID", "r1-test-project");
  vi.stubEnv("HFT_APPWRITE_RUNTIME_API_KEY", "test-runtime-key");
  vi.stubEnv("HFT_ALLOWED_ACCOUNT_EMAILS", "user1@test.io");
  vi.stubEnv("HFT_AUTH_HMAC_SECRET", "test-hmac-secret");
  vi.stubEnv("HFT_APP_ORIGIN", "https://hft.test");
});

function emptyReadRepositories(): ApplicationRepositories {
  const selfProfile = {
    userId: "user-1" as UserId,
    displayName: "Raiyan",
    displayEmail: "user1@test.io",
    emailKey: "user1@test.io",
    createdAt: SEED_INSTANT_ISO,
    updatedAt: SEED_INSTANT_ISO,
  };
  return {
    profiles: {
      getById: async (id: UserId) => (String(id) === "user-1" ? selfProfile : undefined),
    },
    households: {},
    memberships: {
      findActiveByUser: async () => undefined,
    },
    joinRequests: {
      findPendingByUser: async () => undefined,
    },
  } as unknown as ApplicationRepositories;
}

function contextWith(reader: InMemoryTablesReader): ReturnType<typeof buildProductRequestContext> {
  const dependencies = {
    repositories: emptyReadRepositories(),
    atomic: {} as AtomicApplicationPersistence,
    session: { getCurrentUserId: async () => "user-1" as UserId, subscribe: () => () => undefined } as CurrentSession,
    values: { now: (): IsoInstant => NOW, nextId: () => "x", nextHouseholdCodeCandidate: () => "000000000" } as ApplicationValues,
  };
  const application = new HouseFinanceApplication(dependencies);
  return {
    actor: { userId: "user-1" as UserId, email: "user1@test.io" },
    repositories: reader,
    tables: reader,
    dependencies,
    application,
    capabilities: PRODUCTION_R4_CAPABILITIES,
    enforceHouseCodeThrottle: async () => undefined,
  } as unknown as ReturnType<typeof buildProductRequestContext>;
}

describe("trusted production request context", () => {
  it("builds a real context with server clock values and production capabilities", async () => {
    const built = buildProductRequestContext({ userId: "user_abc" as UserId, email: "abc@test.io" });
    expect(built.capabilities).toBe(PRODUCTION_R4_CAPABILITIES);
    await expect(built.dependencies.session.getCurrentUserId()).resolves.toBe("user_abc");
    expect(built.dependencies.values.now()).toMatch(/Z$/);
    expect(typeof built.dependencies.atomic.createExpense).toBe("function");
    expect(typeof built.dependencies.atomic.createSettlement).toBe("function");
    expect(typeof built.dependencies.atomic.createCard).toBe("function");
  });

  it("reports the server-authoritative Asia/Dhaka business date", async () => {
    const context = contextWith(new InMemoryTablesReader());
    expect(await loadBusinessDate(context)).toBe(businessDateAt(NOW));
  });

  it("assembles the bootstrap projection with session view and no-household state", async () => {
    const bootstrap = await loadBootstrap(contextWith(new InMemoryTablesReader()));
    expect(bootstrap.capabilities).toEqual(PRODUCTION_R4_CAPABILITIES);
    // 18:30 UTC is already the next calendar day in Asia/Dhaka.
    expect(bootstrap.businessDate).toBe("2026-08-27");
    expect(bootstrap.household).toEqual({ status: "no-household" });
    expect(bootstrap.session.roleLabel).toBe("No active household");
    expect(bootstrap.session.settlementActionCount).toBe(0);
  });
});
