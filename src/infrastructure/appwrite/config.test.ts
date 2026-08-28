import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadAppwriteProvisioningConfig,
  loadAppwriteOperatorConfig,
  loadAppwriteServerConfig,
  MAX_APPROVED_ACCOUNT_EMAILS,
  mergeDotEnvFile,
  validateApplicationOrigin,
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
    expect(result.errors?.join(" ")).toContain("HFT_APPWRITE_ENDPOINT");
    expect(result.errors?.join(" ")).toContain("HFT_APPWRITE_PROJECT_ID");
  });

  it("rejects malformed endpoints and project ids", () => {
    const result = loadAppwriteServerConfig({ HFT_APPWRITE_ENDPOINT: "not-a-url", HFT_APPWRITE_PROJECT_ID: "bad id!" });
    expect(result.ok).toBe(false);
    expect(result.errors?.join(" ")).toContain("HFT_APPWRITE_ENDPOINT");
    expect(result.errors?.join(" ")).toContain("HFT_APPWRITE_PROJECT_ID");
  });

  it("loads only the Site-safe HFT runtime manifest", () => {
    const result = loadAppwriteServerConfig({
      HFT_APPWRITE_ENDPOINT: "https://syd.cloud.appwrite.io/v1",
      HFT_APPWRITE_PROJECT_ID: "hft-prod",
      HFT_APPWRITE_RUNTIME_API_KEY: "runtime-secret",
      HFT_AUTH_HMAC_SECRET: "hmac-secret",
      HFT_APP_ORIGIN: "https://hft.appwrite.network",
      HFT_ALLOWED_ACCOUNT_EMAILS: "raiyan@test.io",
      NODE_ENV: "production",
    });
    expect(result.ok).toBe(true);
    expect(result.value?.runtimeApiKey).toBe("runtime-secret");
    expect(result.value?.authSecret).toBe("hmac-secret");
    expect(result.value?.appOrigin).toBe("https://hft.appwrite.network");
    expect(result.value).not.toHaveProperty("bootstrapApiKey");
    expect(result.value?.accountEmails).toEqual({ status: "enabled", emails: ["raiyan@test.io"] });
  });

  it("fails closed when any deployed runtime value is missing", () => {
    const result = loadAppwriteServerConfig({
      HFT_APPWRITE_ENDPOINT: "https://syd.cloud.appwrite.io/v1",
      HFT_APPWRITE_PROJECT_ID: "hft-prod",
      HFT_ALLOWED_ACCOUNT_EMAILS: "",
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.join(" ")).toContain("HFT_APPWRITE_RUNTIME_API_KEY");
    expect(result.errors?.join(" ")).toContain("HFT_AUTH_HMAC_SECRET");
    expect(result.errors?.join(" ")).toContain("HFT_APP_ORIGIN");
  });

  it("keeps the temporary provisioning key out of normal runtime configuration", () => {
    const result = loadAppwriteServerConfig({
      HFT_APPWRITE_ENDPOINT: "https://syd.cloud.appwrite.io/v1",
      HFT_APPWRITE_PROJECT_ID: "hft-prod",
      HFT_APPWRITE_RUNTIME_API_KEY: "runtime-secret",
      HFT_AUTH_HMAC_SECRET: "hmac-secret",
      HFT_APP_ORIGIN: "https://hft.appwrite.network",
      HFT_ALLOWED_ACCOUNT_EMAILS: "member@test.io",
      APPWRITE_BOOTSTRAP_API_KEY: "bootstrap-secret",
      APPWRITE_PROVISIONING_API_KEY: "provisioning-secret",
    });
    expect(result.ok).toBe(true);
    expect(result.value).not.toHaveProperty("provisioningApiKey");
  });

  it("keeps APPWRITE-prefixed operator configuration out of the deployed runtime loader", () => {
    const operator = loadAppwriteOperatorConfig({
      APPWRITE_ENDPOINT: "https://syd.cloud.appwrite.io/v1",
      APPWRITE_PROJECT_ID: "hft-prod",
      APPWRITE_RUNTIME_API_KEY: "runtime-secret",
      APPWRITE_BOOTSTRAP_API_KEY: "bootstrap-secret",
      ALLOWED_ACCOUNT_EMAILS: "member@test.io",
    });
    expect(operator.ok).toBe(true);
    expect(operator.value?.bootstrapApiKey).toBe("bootstrap-secret");
    expect(operator.value?.runtimeApiKey).toBe("runtime-secret");
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

describe("trusted production origin", () => {
  it("accepts only canonical HTTPS origins in production", () => {
    expect(validateApplicationOrigin("https://hft.appwrite.network", true)).toBe("https://hft.appwrite.network");
    for (const value of [
      "http://hft.appwrite.network",
      "https://hft.appwrite.network/",
      "https://hft.appwrite.network/path",
      "https://hft.appwrite.network?x=1",
      "https://hft.appwrite.network#x",
      "https://user:pass@hft.appwrite.network",
      " https://hft.appwrite.network",
    ]) expect(validateApplicationOrigin(value, true)).toBeUndefined();
  });

  it("permits explicitly configured loopback HTTP only outside production", () => {
    expect(validateApplicationOrigin("http://localhost:3000", false)).toBe("http://localhost:3000");
    expect(validateApplicationOrigin("http://example.test", false)).toBeUndefined();
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
