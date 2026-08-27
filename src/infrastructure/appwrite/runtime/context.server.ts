import "server-only";


import type { ApplicationRepositories, CurrentSession } from "@/application/repositories";
import { PRODUCTION_R2_CAPABILITIES, type ProductCapabilities } from "@/application/runtime-capabilities";
import { HouseFinanceApplication, type ApplicationValues, type Dependencies, type GeneratedIdKind } from "@/application/services/application-services";
import { userId, type UserId } from "@/domain/shared/identifiers";
import { isoInstant, type IsoInstant } from "@/domain/shared/instant";
import { AppwriteCommandPersistence } from "./command-persistence.server";
import { ensureProfile, AUTH_THROTTLE_RULES } from "../auth/account-service.server";
import { enforceAuthThrottle } from "../auth/throttle.server";
import { AuthError } from "../auth/auth-errors.server";
import { createAppwriteAuthClients } from "../auth/clients.server";
import { loadAppwriteServerConfig } from "../config";

import { createAppwriteReadRepositories, createTablesReader, type AppwriteReadRepositories } from "../reads/read-repositories.server";
import type { TablesReader } from "../reads/tables.server";
import { ActorRequiredError, type TrustedActorResolution } from "./actor.server";

export interface TrustedActor {
  readonly userId: UserId;
  readonly email: string;
}

/**
 * Request-scoped trusted context for the production read plane. The actor is
 * resolved exclusively from the HttpOnly Appwrite session cookie; no client
 * payload can influence identity. The repository set is read-only by
 * construction: write-bearing interface members exist only as unreachable
 * guards that R2's command adapters will replace.
 */
export interface ProductRequestContext {
  readonly actor: TrustedActor;
  readonly repositories: AppwriteReadRepositories;
  readonly tables: TablesReader;
  readonly dependencies: Dependencies;
  readonly application: HouseFinanceApplication;
  readonly capabilities: ProductCapabilities;
  /** Opaque HMAC-windowed throttle for house-code lookup/generation reads. */
  enforceHouseCodeThrottle(identityParts: readonly string[]): Promise<void>;
}

const COMPACT_ID_PREFIX: Record<GeneratedIdKind, string> = {
  user: "u",
  household: "h",
  "join-request": "j",
  expense: "e",
  settlement: "s",
  card: "c",
  receipt: "r",
  audit: "a",
  command: "k",
};

/**
 * Production identifiers stay within provider row-id constraints (<=36 chars,
 * [A-Za-z0-9._-]) while remaining opaque and collision-resistant.
 */
function nextCompactId(kind: GeneratedIdKind): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let suffix = "";
  for (let index = 0; index < 20; index += 1) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    suffix += alphabet[(bytes[0] ?? 0) % alphabet.length];
  }
  return `${COMPACT_ID_PREFIX[kind]}${suffix}`;
}

function serverApplicationValues(): ApplicationValues {
  return {
    now: (): IsoInstant => isoInstant(new Date().toISOString()),
    nextId: nextCompactId,
    nextHouseholdCodeCandidate: (): string => {
      const bytes = new Uint32Array(1);
      crypto.getRandomValues(bytes);
      const unbiasedLimit = 4_000_000_000;
      const value = bytes[0] ?? 0;
      const bounded = value >= unbiasedLimit ? value % unbiasedLimit : value;
      return String(bounded % 1_000_000_000).padStart(9, "0");
    },
  };
}

class TrustedSession implements CurrentSession {
  constructor(private readonly actorId: UserId) {}
  async getCurrentUserId(): Promise<UserId> {
    return this.actorId;
  }
  subscribe(): () => void {
    // Server request scope has no live session stream; reconstruction happens
    // per request and on client focus refresh.
    return () => undefined;
  }
}

/**
 * Resolves the trusted actor from the HttpOnly session secret, mirroring the
 * authentication restore semantics (allowlist check + idempotent Profile
 * bootstrap). Failures classify as anonymous or provider-unavailable without
 * leaking provider detail.
 */
export async function resolveTrustedActor(sessionSecret: string | undefined): Promise<TrustedActorResolution> {
  if (!sessionSecret) return Object.freeze({ status: "anonymous" });
  const config = loadAppwriteServerConfig();
  if (!config.ok || !config.value) return Object.freeze({ status: "provider-unavailable" });
  const clients = createAppwriteAuthClients(config.value);
  try {
    const account = await clients.sessionAccount(sessionSecret).get();
    const email = account.email.trim().toLowerCase();
    const emails = config.value.accountEmails;
    if (emails.status !== "enabled" || !emails.emails.includes(email)) {
      return Object.freeze({ status: "anonymous" });
    }
    await ensureProfile(clients.tablesDB(), { id: account.$id, email: account.email });
    return Object.freeze({ status: "authenticated", userId: userId(account.$id), email: account.email });
  } catch (error) {
    const candidate = error as { code?: unknown; type?: unknown };
    const unauthorized =
      candidate?.type === "user_unauthorized" ||
      candidate?.type === "general_unauthorized_scope" ||
      candidate?.type === "user_not_found" ||
      (typeof candidate?.code === "number" && (candidate.code === 401 || candidate.code === 403));
    if (unauthorized) return Object.freeze({ status: "anonymous" });
    console.error("[trusted-actor] provider failure", {
      code: typeof candidate?.code === "number" ? candidate.code : "unknown",
      type: typeof candidate?.type === "string" ? candidate.type : "unknown",
    });
    return Object.freeze({ status: "provider-unavailable" });
  }
}

export function buildProductRequestContext(actor: TrustedActor): ProductRequestContext {
  const config = loadAppwriteServerConfig();
  if (!config.ok || !config.value) {
    throw new Error("Production data plane configuration is unavailable.");
  }
  const clients = createAppwriteAuthClients(config.value);
  const tablesDB = clients.tablesDB();
  const tables = createTablesReader(tablesDB);
  const commandPersistence = new AppwriteCommandPersistence(tablesDB);
  const repositories = createAppwriteReadRepositories(tables, actor.userId, actor.email);
  const dependencies: Dependencies = {
    repositories: repositories as unknown as ApplicationRepositories,
    atomic: commandPersistence,
    session: new TrustedSession(actor.userId),
    values: serverApplicationValues(),
  };
  const application = new HouseFinanceApplication(dependencies);
  const authSecret = process.env.AUTH_HMAC_SECRET;
  return Object.freeze({
    actor,
    repositories,
    tables,
    dependencies,
    application,
    capabilities: PRODUCTION_R2_CAPABILITIES,
    enforceHouseCodeThrottle: async (identityParts: readonly string[]) => {
      if (!authSecret) {
        throw new AuthError("PROVIDER_UNAVAILABLE", "The service is temporarily unavailable.");
      }
      await enforceAuthThrottle(tablesDB, {
        secret: authSecret,
        rule: AUTH_THROTTLE_RULES.houseCodeLookup,
        identityParts,
      });
    },
  });
}

export function requireActor(resolution: TrustedActorResolution): TrustedActor {
  if (resolution.status !== "authenticated") throw new ActorRequiredError();
  return { userId: resolution.userId, email: resolution.email };
}
