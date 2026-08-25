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
          /APPWRITE_(RUNTIME_API_KEY|BOOTSTRAP_API_KEY|PROVISIONING_API_KEY)/.test(source) &&
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

  it("has no public account-creation endpoint or command", () => {
    expect(existsSync(join(SRC, "app", "api", "auth", "register", "route.ts"))).toBe(false);
    const activeSources = sourceFiles(SRC).filter((file) => !file.includes(".test.")).map(read).join("\n");
    expect(activeSources).not.toContain("/api/auth/register");
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
    expect(configSource).toMatch(/interface AppwriteServerConfig[\s\S]*runtimeApiKey[\s\S]*bootstrapApiKey[\s\S]*accountEmails/);
    expect(configSource.match(/interface AppwriteServerConfig\s*\{([\s\S]*?)\n\}/)?.[1]).not.toContain("provisioningApiKey");
    expect(configSource.match(/interface AppwriteProvisioningConfig\s*\{([\s\S]*?)\n\}/)?.[1]).not.toMatch(/runtimeApiKey|bootstrapApiKey/);
  });

  it("keeps production composition free of local DEV identity and IndexedDB runtime tooling", () => {
    const productionProvider = read(join(SRC, "app", "_providers", "production-session-provider.client.tsx"));
    expect(productionProvider).not.toMatch(/LocalApplicationRuntime|DevelopmentTools|indexedDB|IndexedDb/);
    const productLayout = read(join(SRC, "app", "(product)", "layout.tsx"));
    expect(productLayout).toMatch(/composition === "appwrite"[\s\S]*<ProductionSessionProvider \/>/);
  });

  it("contains no active verification or production-email-edit implementation", () => {
    const activeSources = sourceFiles(SRC).filter((file) => !file.includes(".test.")).map(read).join("\n");
    expect(activeSources).not.toMatch(/\/verify-email|emailVerified|createVerification|updateVerification|updateEmail\s*\(/);
    expect(existsSync(join(SRC, "app", "api", "auth", "email-change", "route.ts"))).toBe(false);
  });
});
