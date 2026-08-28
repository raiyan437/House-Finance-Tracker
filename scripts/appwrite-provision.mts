import {
  loadAppwriteProvisioningConfig,
  loadAppwriteOperatorConfig,
  mergeDotEnvFile,
} from "../src/infrastructure/appwrite/config";

mergeDotEnvFile(".env.local");

const oneUserSmoke = process.argv.includes("--one-unprovisioned-smoke");
const emailArgIndex = process.argv.indexOf("--email");
const email = emailArgIndex >= 0 ? process.argv[emailArgIndex + 1] : undefined;
if (!oneUserSmoke && !email) {
  console.error("Usage: npm run appwrite:provision -- --email <approved-email> | --one-unprovisioned-smoke");
  process.exit(1);
}

const BUSINESS_TABLE_IDS = [
  "households",
  "memberships",
  "join_requests",
  "expenses",
  "expense_card_private_details",
  "settlements",
  "cards",
  "receipt_metadata",
  "audit_events",
  "command_outcomes",
  "receipt_reservations",
] as const;

async function rowCount(tablesDB: import("node-appwrite").TablesDB, tableId: string): Promise<number> {
  const result = await tablesDB.listRows({ databaseId: "hft", tableId });
  return result.total;
}

async function main(): Promise<void> {
  const { createProvisioningClients } = await import("../src/infrastructure/appwrite/provisioning/provision.server");
  const { provisionApprovedAccount } = await import("../src/infrastructure/appwrite/provisioning/provision.server");
  const provisioningConfig = loadAppwriteProvisioningConfig();
  if (!provisioningConfig.ok || !provisioningConfig.value) {
    console.error("Appwrite configuration is invalid.");
    process.exit(1);
  }
  if (provisioningConfig.value.accountEmails.status !== "enabled") {
    console.error("ALLOWED_ACCOUNT_EMAILS is missing, invalid, empty, or exceeds the approved account limit — provisioning is disabled.");
    process.exit(1);
  }
  const { users } = createProvisioningClients(provisioningConfig.value);

  if (oneUserSmoke) {
    const runtimeConfig = loadAppwriteOperatorConfig();
    if (!runtimeConfig.ok || !runtimeConfig.value?.runtimeApiKey) {
      console.error("Runtime read configuration is invalid.");
      process.exit(1);
    }
    const { createAppwriteAuthClients } = await import("../src/infrastructure/appwrite/auth/clients.server");
    const tablesDB = createAppwriteAuthClients({
      endpoint: runtimeConfig.value.endpoint,
      projectId: runtimeConfig.value.projectId,
      runtimeApiKey: runtimeConfig.value.runtimeApiKey as string,
    }).tablesDB();
    const approvedEmails = provisioningConfig.value.accountEmails.emails;
    const beforeUsers = await users.list({ queries: [] });
    const normalizedExisting = beforeUsers.users.map((user) => user.email.trim().toLowerCase());
    const providerConflict = normalizedExisting.some((existingEmail) => !approvedEmails.includes(existingEmail));
    if (providerConflict || beforeUsers.total > 4) {
      console.error("Provisioning preflight found a sanitized provider/account-list conflict.");
      process.exit(1);
    }
    const existingSet = new Set(normalizedExisting);
    const eligible = approvedEmails.filter((approvedEmail) => !existingSet.has(approvedEmail));
    if (eligible.length === 0) {
      console.error("No eligible unprovisioned approved account remains.");
      process.exit(1);
    }

    const profilesBefore = await rowCount(tablesDB, "profiles");
    const businessBefore = await Promise.all(BUSINESS_TABLE_IDS.map((tableId) => rowCount(tablesDB, tableId)));
    if (businessBefore.some((count) => count !== 0)) {
      console.error("Provisioning preflight found existing business data.");
      process.exit(1);
    }

    const selected = eligible[0];
    const result = await provisionApprovedAccount({ users, approvedAccountEmails: approvedEmails }, selected);
    const afterUsers = await users.list({ queries: [] });
    const normalizedAfter = new Set(afterUsers.users.map((user) => user.email.trim().toLowerCase()));
    const profilesAfter = await rowCount(tablesDB, "profiles");
    const businessAfter = await Promise.all(BUSINESS_TABLE_IDS.map((tableId) => rowCount(tablesDB, tableId)));
    const remaining = approvedEmails.filter((approvedEmail) => !normalizedAfter.has(approvedEmail));
    if (
      result.status !== "created" ||
      afterUsers.total !== beforeUsers.total + 1 ||
      !normalizedAfter.has(selected) ||
      remaining.length !== eligible.length - 1 ||
      profilesAfter !== profilesBefore ||
      businessAfter.some((count) => count !== 0)
    ) {
      console.error("Provisioning post-check failed after the single-account operation; manual review is required.");
      process.exit(1);
    }

    console.log(`eligible unprovisioned approved accounts found: ${eligible.length}`);
    console.log(`provisioning result: ${result.status}`);
    console.log(`Auth user count before/after: ${beforeUsers.total}/${afterUsers.total}`);
    console.log(`Profile count before provisioning: ${profilesBefore}`);
    console.log("business tables remain empty: yes");
    return;
  }

  if (!email) {
    console.error("An approved email argument is required.");
    process.exit(1);
  }
  const result = await provisionApprovedAccount({
    users,
    approvedAccountEmails: provisioningConfig.value.accountEmails.emails,
  }, email);
  console.log(`Provisioning result: ${result.status}`);
  console.log("Next step: the approved household member uses /forgot-password to establish their password.");
}

void main().catch(() => {
  console.error("Provisioning failed without exposing provider or account details.");
  process.exitCode = 1;
});
