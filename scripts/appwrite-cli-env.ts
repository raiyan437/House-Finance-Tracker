/**
 * Shared CLI environment loader for Appwrite operator tooling.
 *
 * Default remains the production configuration (.env.local). Gate C / test
 * tooling MUST pass an explicit separate env file (e.g. .env.gate-c.local)
 * so disposable-project credentials never mix with production ones.
 */
import { existsSync, readFileSync } from "node:fs";

export interface AppwriteCliEnv {
  readonly envFile: string;
  readonly endpoint: string;
  readonly projectId: string;
  readonly runtimeApiKey: string;
  readonly bootstrapApiKey?: string;
}

function parseEnvFile(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, "utf8").split(/\r?\n/).map((line) => {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      return match ? [match[1], match[2]] : [];
    }).filter(Boolean),
  );
}

export function resolveEnvFile(argv: string[]): string {
  const index = argv.indexOf("--env-file");
  const explicit = index >= 0 ? argv[index + 1] : undefined;
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`Specified env file not found: ${explicit}`);
    return explicit;
  }
  // Tooling that REQUIRES isolation passes requireIsolated through argv marker.
  if (argv.includes("--isolated")) {
    const fallback = ".env.gate-c.local";
    if (!existsSync(fallback)) {
      throw new Error(
        "GATE C BLOCKED — DISPOSABLE PROJECT REQUIRED. Create .env.gate-c.local with the disposable project's APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID / APPWRITE_RUNTIME_API_KEY / APPWRITE_BOOTSTRAP_API_KEY.",
      );
    }
    return fallback;
  }
  return ".env.local";
}

export function loadAppwriteCliEnv(argv: string[] = process.argv): AppwriteCliEnv {
  const envFile = resolveEnvFile(argv);
  const env = parseEnvFile(envFile);
  const endpoint = env.APPWRITE_ENDPOINT;
  const projectId = env.APPWRITE_PROJECT_ID;
  const runtimeApiKey = env.APPWRITE_RUNTIME_API_KEY;
  if (!endpoint || !projectId || !runtimeApiKey) {
    throw new Error(`Env file ${envFile} is missing APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID / APPWRITE_RUNTIME_API_KEY.`);
  }
  return { envFile, endpoint, projectId, runtimeApiKey, bootstrapApiKey: env.APPWRITE_BOOTSTRAP_API_KEY };
}

/** The REAL production project id, read from the untouched .env.local. */
export function productionProjectId(): string | undefined {
  if (!existsSync(".env.local")) return undefined;
  return parseEnvFile(".env.local").APPWRITE_PROJECT_ID;
}

/**
 * Fail-closed safeguard (Gate C §2): destructive/restoring tooling must prove
 * the connected project is NOT the known production project.
 */
export function assertNotProduction(projectId: string, actionLabel: string): void {
  const production = productionProjectId();
  if (!production) {
    throw new Error(`${actionLabel} refused: the production project id could not be proven from .env.local.`);
  }
  if (projectId === production) {
    throw new Error(`${actionLabel} refused: connected project id matches the PRODUCTION project.`);
  }
}

/** Sanitized proof metadata — never includes keys. */
export function sanitizeProjectMeta(env: AppwriteCliEnv): Record<string, string> {
  return {
    envFile: env.envFile,
    endpointHost: new URL(env.endpoint).host,
    projectId: env.projectId,
    isProduction: String(projectIdMatchesProduction(env.projectId)),
  };
}

export function projectIdMatchesProduction(projectId: string): boolean {
  const production = productionProjectId();
  return production !== undefined && production === projectId;
}
