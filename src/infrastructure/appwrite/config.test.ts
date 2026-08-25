import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadAppwriteProvisioningConfig,
  loadAppwriteServerConfig,
  MAX_APPROVED_ACCOUNT_EMAILS,
  mergeDotEnvFile,
  validateAccountEmails,
} from "./config";

describe("approved account email configuration (fail-closed)", () => {
  it("disables approved-account access when the configuration is missing or blank", () => {
    expect(validateAccountEmails(undefined)).toEqual({ status: "disabled", reason: "missing" });
    expect(validateAccountEmails("   ")).toEqual({ status: "disabled", reason: "empty" });
  });

  it("never enables accounts because of a configuration failure mode", () => {
    const results = ["not-an-email", "a@b.com,bad,"].map((raw) => validateAccountEmails(raw));
    for (const result of results) {
      expect(result.status).toBe("disabled");
      if (result.status !== "disabled") throw new Error("Expected fail-closed approved-account configuration.");
    }
    const tooManyDistinct = validateAccountEmails("a@b.co,c@d.co,e@f.co,g@h.co,i@j.co");
    expect(tooManyDistinct).toEqual({ status: "disabled", reason: "too_many_entries" });
  });

  it("collapses duplicate approved-account entries before applying the four-seat cap", () => {
    expect(validateAccountEmails("a@b.io,a@b.io,a@b.io")).toEqual({ status: "enabled", emails: ["a@b.io"] });
  });

  it("accepts at most four normalized unique emails", () => {
    const result = validateAccountEmails(" Raiyan@Test.IO , john@test.io , sarah@test.io , kim@test.io ");
    expect(result).toEqual({ status: "enabled", emails: ["raiyan@test.io", "john@test.io", "sarah@test.io", "kim@test.io"] });
    expect(MAX_APPROVED_ACCOUNT_EMAILS).toBe(4);
    expect(validateAccountEmails("a@b.co,c@d.co,e@f.co,g@h.co,i@j.co").status).toBe("disabled");
  });
});

describe("server config loading", () => {
  it("reports precise errors instead of throwing when required values are absent", () => {
    const result = loadAppwriteServerConfig({});
    expect(result.ok).toBe(false);
    expect(result.errors?.join(" ")).toContain("APPWRITE_ENDPOINT");
    expect(result.errors?.join(" ")).toContain("APPWRITE_PROJECT_ID");
  });

  it("rejects malformed endpoints and project ids", () => {
    const result = loadAppwriteServerConfig({ APPWRITE_ENDPOINT: "not-a-url", APPWRITE_PROJECT_ID: "bad id!" });
    expect(result.ok).toBe(false);
    expect(result.errors?.length).toBe(2);
  });

  it("loads a complete runtime configuration with credentials separated from bootstrap credentials", () => {
    const result = loadAppwriteServerConfig({
      APPWRITE_ENDPOINT: "https://syd.cloud.appwrite.io/v1",
      APPWRITE_PROJECT_ID: "hft-prod",
      APPWRITE_RUNTIME_API_KEY: "runtime-secret",
      APPWRITE_BOOTSTRAP_API_KEY: "bootstrap-secret",
      ALLOWED_ACCOUNT_EMAILS: "raiyan@test.io",
    });
    expect(result.ok).toBe(true);
    expect(result.value?.runtimeApiKey).toBe("runtime-secret");
    expect(result.value?.bootstrapApiKey).toBe("bootstrap-secret");
    expect(result.value?.accountEmails).toEqual({ status: "enabled", emails: ["raiyan@test.io"] });
  });

  it("keeps bootstrap and runtime keys optional at load time so plan mode works without secrets", () => {
    const result = loadAppwriteServerConfig({
      APPWRITE_ENDPOINT: "https://syd.cloud.appwrite.io/v1",
      APPWRITE_PROJECT_ID: "hft-prod",
      ALLOWED_ACCOUNT_EMAILS: "",
    });
    expect(result.ok).toBe(true);
    expect(result.value?.bootstrapApiKey).toBeUndefined();
    expect(result.value?.runtimeApiKey).toBeUndefined();
    expect(result.value?.accountEmails.status).toBe("disabled");
  });

  it("keeps the temporary provisioning key out of normal runtime configuration", () => {
    const result = loadAppwriteServerConfig({
      APPWRITE_ENDPOINT: "https://syd.cloud.appwrite.io/v1",
      APPWRITE_PROJECT_ID: "hft-prod",
      APPWRITE_RUNTIME_API_KEY: "runtime-secret",
      APPWRITE_BOOTSTRAP_API_KEY: "bootstrap-secret",
      APPWRITE_PROVISIONING_API_KEY: "provisioning-secret",
      ALLOWED_ACCOUNT_EMAILS: "member@test.io",
    });
    expect(result.ok).toBe(true);
    expect(result.value).not.toHaveProperty("provisioningApiKey");
  });

  it("loads the provisioning key only through the dedicated fail-closed configuration", () => {
    const missing = loadAppwriteProvisioningConfig({
      APPWRITE_ENDPOINT: "https://syd.cloud.appwrite.io/v1",
      APPWRITE_PROJECT_ID: "hft-prod",
      ALLOWED_ACCOUNT_EMAILS: "member@test.io",
    });
    expect(missing.ok).toBe(false);
    expect(missing.errors?.join(" ")).toContain("APPWRITE_PROVISIONING_API_KEY");

    const loaded = loadAppwriteProvisioningConfig({
      APPWRITE_ENDPOINT: "https://syd.cloud.appwrite.io/v1",
      APPWRITE_PROJECT_ID: "hft-prod",
      APPWRITE_RUNTIME_API_KEY: "runtime-secret",
      APPWRITE_BOOTSTRAP_API_KEY: "bootstrap-secret",
      APPWRITE_PROVISIONING_API_KEY: "provisioning-secret",
      ALLOWED_ACCOUNT_EMAILS: "member@test.io",
    });
    expect(loaded.ok).toBe(true);
    expect(loaded.value?.provisioningApiKey).toBe("provisioning-secret");
    expect(loaded.value).not.toHaveProperty("runtimeApiKey");
    expect(loaded.value).not.toHaveProperty("bootstrapApiKey");
  });
});

describe("local env file merging", () => {
  it("loads missing keys from a dotenv file, strips quotes, and never overrides existing values", () => {
    const dir = mkdtempSync(join(tmpdir(), "hft-env-"));
    try {
      const file = join(dir, ".env.local");
      writeFileSync(file, ["APPWRITE_ENDPOINT=https://syd.cloud.appwrite.io/v1", "APPWRITE_PROJECT_ID=\"hft-prod\"", "# comment", "", "APPWRITE_RUNTIME_API_KEY=secret"].join("\n"));
      const env: Record<string, string | undefined> = { APPWRITE_PROJECT_ID: "already-set" };
      expect(mergeDotEnvFile(file, env)).toBe(2);
      expect(env.APPWRITE_ENDPOINT).toBe("https://syd.cloud.appwrite.io/v1");
      expect(env.APPWRITE_PROJECT_ID).toBe("already-set");
      expect(env.APPWRITE_RUNTIME_API_KEY).toBe("secret");
      expect(mergeDotEnvFile(join(dir, "missing.env"), env)).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
