import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

describe("Appwrite infrastructure containment", () => {
  it("confines the Appwrite SDK to the Appwrite adapter module", () => {
    const violations = sourceFiles(SRC)
      .map((file) => ({ file: relative(ROOT, file).replaceAll("\\", "/"), source: read(file) }))
      .filter(({ file, source }) => /from ["']node-appwrite["']/.test(source) && !file.startsWith("src/infrastructure/appwrite/"))
      .map(({ file }) => file);
    expect(violations).toEqual([]);
  });

  it("keeps secret environment names inside the appwrite config module", () => {
    const violations = sourceFiles(SRC)
      .map((file) => ({ file: relative(ROOT, file).replaceAll("\\", "/"), source: read(file) }))
      .filter(
        ({ file, source }) =>
          /(?:HFT_APPWRITE_RUNTIME_API_KEY|HFT_AUTH_HMAC_SECRET|APPWRITE_(?:RUNTIME_API_KEY|BOOTSTRAP_API_KEY|PROVISIONING_API_KEY))/.test(source) &&
          !file.startsWith("src/infrastructure/appwrite/") &&
          !file.includes("appwrite-boundaries.test"),
      )
      .map(({ file }) => file);
    expect(violations).toEqual([]);
  });

  it("prevents presentation and application layers from importing the production adapter", () => {
    const violations = sourceFiles(join(SRC, "presentation"))
      .concat(sourceFiles(join(SRC, "application")))
      .concat(sourceFiles(join(SRC, "domain")))
      .map((file) => relative(ROOT, file).replaceAll("\\", "/"))
      .filter((file) => /@\/infrastructure\/appwrite/.test(read(join(ROOT, file))));
    expect(violations).toEqual([]);
  });

  it("does not wire the production adapter into the client runtime composition yet", () => {
    const violations = sourceFiles(join(SRC, "infrastructure"))
      .map((file) => relative(ROOT, file).replaceAll("\\", "/"))
      .filter((file) => !file.startsWith("src/infrastructure/appwrite/"))
      .filter((file) => !file.endsWith("appwrite-boundaries.test.ts"))
      .filter((file) => read(join(ROOT, file)).includes("infrastructure/appwrite"));
    expect(violations).toEqual([]);
  });

  it("keeps account provisioning unreachable from every product route", () => {
    const appSources = sourceFiles(join(SRC, "app")).map(read).join("\n");
    expect(appSources).not.toMatch(/appwrite\/provisioning|appwrite-provision|APPWRITE_PROVISIONING_API_KEY/);
  });

  it("exposes only the approved allowlisted signup endpoint for account creation", () => {
    expect(existsSync(join(SRC, "app", "api", "auth", "register", "route.ts"))).toBe(false);
    const activeSources = sourceFiles(SRC).filter((file) => !file.includes(".test.")).map(read).join("\n");
    expect(activeSources).not.toContain("/api/auth/register");
    expect(existsSync(join(SRC, "app", "api", "auth", "signup", "route.ts"))).toBe(true);
    expect(activeSources).toContain("/api/auth/signup");
  });

  it("confines the temporary provisioning credential to dedicated server configuration and tooling", () => {
    const allowed = new Set([
      "src/architecture/appwrite-boundaries.test.ts",
      "src/infrastructure/appwrite/config.test.ts",
      "src/infrastructure/appwrite/config.ts",
      "src/infrastructure/appwrite/provisioning/provision.server.test.ts",
      "src/infrastructure/appwrite/provisioning/provision.server.ts",
      "scripts/appwrite-provision.mts",
    ]);
    const candidates = sourceFiles(SRC).concat([join(ROOT, "scripts", "appwrite-provision.mts")]);
    const violations = candidates
      .map((file) => ({ file: relative(ROOT, file).replaceAll("\\", "/"), source: read(file) }))
      .filter(({ source }) => source.includes("APPWRITE_PROVISIONING_API_KEY"))
      .map(({ file }) => file)
      .filter((file) => !allowed.has(file));
    expect(violations).toEqual([]);
    const cliSource = read(join(ROOT, "scripts", "appwrite-provision.mts"));
    expect(cliSource).not.toMatch(/result\.userId|\$\{email\}|\$\{[^}]*secret|\$\{[^}]*password/i);
    expect(cliSource).not.toMatch(/console\.(?:log|error)\(\s*(?:email|secret|password|userId)\b/i);
  });

  it("keeps runtime, bootstrap, and provisioning client credentials structurally separate", () => {
    const configSource = read(join(SRC, "infrastructure", "appwrite", "config.ts"));
    const runtimeBlock = configSource.match(/interface AppwriteServerConfig\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const operatorBlock = configSource.match(/interface AppwriteOperatorConfig\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(runtimeBlock).toMatch(/runtimeApiKey[\s\S]*authSecret[\s\S]*appOrigin[\s\S]*accountEmails/);
    expect(runtimeBlock).not.toMatch(/bootstrapApiKey|provisioningApiKey/);
    expect(operatorBlock).toMatch(/runtimeApiKey[\s\S]*bootstrapApiKey/);
    expect(configSource.match(/interface AppwriteProvisioningConfig\s*\{([\s\S]*?)\n\}/)?.[1]).not.toMatch(/runtimeApiKey|bootstrapApiKey/);
  });

  it("uses Site-safe HFT variables exclusively for the deployed runtime", () => {
    const configSource = read(join(SRC, "infrastructure", "appwrite", "config.ts"));
    const runtimeLoader = configSource.match(/export function loadAppwriteServerConfig[\s\S]*?\n\}/)?.[0] ?? "";
    expect(runtimeLoader).toMatch(/HFT_APPWRITE_ENDPOINT[\s\S]*HFT_APPWRITE_PROJECT_ID[\s\S]*HFT_APPWRITE_RUNTIME_API_KEY/);
    expect(runtimeLoader).toMatch(/HFT_AUTH_HMAC_SECRET[\s\S]*HFT_APP_ORIGIN[\s\S]*HFT_ALLOWED_ACCOUNT_EMAILS/);
    expect(runtimeLoader).not.toMatch(/env\.(?:APPWRITE_|AUTH_HMAC_SECRET|ALLOWED_ACCOUNT_EMAILS)/);
    expect(sourceFiles(join(SRC, "app")).map(read).join("\n")).not.toMatch(/NEXT_PUBLIC_.*(?:KEY|SECRET|TOKEN)/);
  });

  it("keeps production composition free of local DEV identity and IndexedDB runtime tooling", () => {
    const providersDir = join(SRC, "app", "_providers");
    const productionSources = sourceFiles(providersDir)
      .filter((file) => file.includes("production"))
      .map(read);
    expect(productionSources.length).toBeGreaterThan(0);
    for (const source of productionSources) {
      expect(source).not.toMatch(/LocalApplicationRuntime|DevelopmentIdentity|indexedDB|IndexedDb|indexeddb\/|local-runtime/);
      expect(source).not.toMatch(/presentation\/devtools\/development-tools["']/);
    }
    const productLayout = read(join(SRC, "app", "(product)", "layout.tsx"));
    expect(productLayout).toMatch(/APP_COMPOSITION === "appwrite"[\s\S]*<SelectedApplicationRuntime composition=\{composition\}>/);
    expect(productLayout).not.toMatch(/LocalApplicationRuntime|ProductionApplicationRuntime/);
    const selectorSource = read(join(SRC, "app", "_providers", "selected-application-runtime.client.tsx"));
    expect(selectorSource).toMatch(/dynamic\([\s\S]*local-product-runtime\.client[\s\S]*production-application-runtime\.client/);
  });

  it("keeps the Appwrite browser boundary free of server SDK and server modules", () => {
    const violations = sourceFiles(join(SRC, "app", "_providers"))
      .filter((file) => file.includes("production"))
      .map((file) => ({ file: relative(ROOT, file).replaceAll("\\", "/"), source: read(file) }))
      .filter(({ source }) => /node-appwrite|\.server["']/.test(source))
      .map(({ file }) => file);
    expect(violations).toEqual([]);
  });

  it("keeps the production reset operator-only and outside deployed runtime source", () => {
    const activeSources = sourceFiles(SRC).filter((file) => !file.includes(".test.")).map(read).join("\n");
    expect(activeSources).not.toMatch(/appwrite-reset-production/);
    const resetCli = read(join(ROOT, "scripts", "appwrite-reset-production.mts"));
    expect(resetCli).toMatch(/parseResetArguments[\s\S]*executionBlocked[\s\S]*verifyBackupForInventory/);
    expect(resetCli).not.toMatch(/HFT_APPWRITE_RUNTIME_API_KEY|HFT_ALLOWED_ACCOUNT_EMAILS|NEXT_PUBLIC_/);
  });

  it("keeps every Appwrite adapter module server-only", () => {
    const violations = sourceFiles(join(SRC, "infrastructure", "appwrite"))
      .filter((file) => !file.endsWith(".test.ts") && read(file).startsWith('"use client"'))
      .map((file) => relative(ROOT, file));
    expect(violations).toEqual([]);
  });

  it("contains no active verification or production-email-edit implementation", () => {
    const activeSources = sourceFiles(SRC).filter((file) => !file.includes(".test.")).map(read).join("\n");
    expect(activeSources).not.toMatch(/\/verify-email|emailVerified|createVerification|updateVerification|updateEmail\s*\(/);
    expect(existsSync(join(SRC, "app", "api", "auth", "email-change", "route.ts"))).toBe(false);
  });
});
