#!/usr/bin/env node
/**
 * Validates bootstrap .env for client workspaces (<client-id> baseline).
 * Usage: node scripts/verify-client-bootstrap-env.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");

if (!existsSync(envPath)) {
  console.error("FAIL: backend/.env not found. Copy from .env.example and set client values.");
  process.exit(1);
}

const raw = readFileSync(envPath, "utf8");
const env = Object.fromEntries(
  raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const idx = line.indexOf("=");
      if (idx === -1) return null;
      return [line.slice(0, idx), line.slice(idx + 1)];
    })
    .filter(Boolean),
);

const errors = [];
const warnings = [];

function requireKey(key) {
  const value = env[key]?.trim();
  if (!value) errors.push(`Missing required key: ${key}`);
  return value ?? "";
}

const clientId = requireKey("CLIENT_ID");
const postgresDb = requireKey("POSTGRES_DB");
const databaseUrl = requireKey("DATABASE_URL");
const redisPassword = requireKey("REDIS_PASSWORD");
const redisUrl = requireKey("REDIS_URL");
const jwtSecret = requireKey("JWT_SECRET");
const jwtRefresh = requireKey("JWT_REFRESH_SECRET");
const opsKey = requireKey("OPS_DB_ENCRYPTION_KEY");

if (clientId === "ecom" || clientId === "ecomtemplate") {
  errors.push("CLIENT_ID must be a client slug (e.g. <client-id>), not template default");
}

if (postgresDb.includes("-")) {
  errors.push("POSTGRES_DB must use underscores only (hyphens invalid in PostgreSQL DB names)");
}

if (/ecom_template/i.test(databaseUrl)) {
  errors.push("DATABASE_URL must not use ecom_template in a client workspace");
}

if (!databaseUrl.includes(postgresDb)) {
  errors.push("DATABASE_URL database name must match POSTGRES_DB exactly");
}

if (!redisPassword) {
  errors.push("REDIS_PASSWORD must be non-empty");
}

if (!redisUrl.includes(redisPassword)) {
  errors.push("REDIS_URL must embed the same password as REDIS_PASSWORD");
}

for (const [key, value] of [
  ["JWT_SECRET", jwtSecret],
  ["JWT_REFRESH_SECRET", jwtRefresh],
  ["OPS_DB_ENCRYPTION_KEY", opsKey],
]) {
  if (/replace_with|change_me/i.test(value)) {
    errors.push(`${key} still contains placeholder text`);
  }
}

if (jwtSecret && jwtRefresh && jwtSecret === jwtRefresh) {
  errors.push("JWT_REFRESH_SECRET must differ from JWT_SECRET");
}

const nodeEnv = (env.NODE_ENV ?? "production").trim().toLowerCase();
if (!["production", "staging"].includes(nodeEnv) && nodeEnv !== "development") {
  warnings.push(`Unexpected NODE_ENV='${env.NODE_ENV}'. Expected production/staging/development.`);
}

const appPort = (env.PORT ?? "").trim();
if (!appPort) {
  errors.push("Missing required key: PORT");
} else if (appPort !== "3000") {
  errors.push("PORT must be 3000 for Docker runtime (host port is BACKEND_PORT).");
}

const paymentProviderRaw = (env.PAYMENT_PROVIDER ?? "").trim().toLowerCase();
const paymentProvider = paymentProviderRaw || "razorpay";
const razorpayEnvKeys = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
const hasRazorpayEnvKeys = razorpayEnvKeys.some((key) => (env[key] ?? "").trim());

if (!["razorpay", "cod", "noop"].includes(paymentProvider)) {
  errors.push(`Unsupported PAYMENT_PROVIDER='${paymentProvider}'. Allowed: razorpay, cod, noop.`);
}

if (!paymentProviderRaw) {
  warnings.push(
    "PAYMENT_PROVIDER is not set — OK for Phase 1. Configure razorpay via Ops UI before prepaid go-live."
  );
} else if (paymentProvider === "razorpay" && !hasRazorpayEnvKeys) {
  errors.push(
    "PAYMENT_PROVIDER=razorpay is set in .env but Razorpay keys are not in .env. " +
      "For VPS Phase 1 bootstrap, remove PAYMENT_PROVIDER from .env and configure payment provider + keys via Ops UI after login."
  );
} else if (paymentProvider === "razorpay") {
  for (const key of razorpayEnvKeys) {
    requireKey(key);
    if (/replace_with|change_me/i.test(env[key] ?? "")) {
      errors.push(`${key} still contains placeholder text`);
    }
  }
} else if (paymentProvider === "cod") {
  warnings.push(
    "PAYMENT_PROVIDER=cod in .env is optional for bootstrap. Prefer omitting it and setting payment mode via Ops UI before prepaid go-live."
  );
}

// Shipping — provider is auto-detected from credentials (resolveDualShippingRuntime).
// SHIPPING_PROVIDER env var is not used for routing and should NOT be set in .env.
const delhiveryEnvKeys = ["DELHIVERY_API_KEY", "DELHIVERY_WEBHOOK_TOKEN"];
const shiprocketEnvKeys = ["SHIPROCKET_EMAIL", "SHIPROCKET_PASSWORD", "SHIPROCKET_WEBHOOK_TOKEN"];
const hasDelhiveryEnvKeys = delhiveryEnvKeys.some((key) => (env[key] ?? "").trim());
const hasShiprocketEnvKeys = shiprocketEnvKeys.some((key) => (env[key] ?? "").trim());

if ((env.SHIPPING_PROVIDER ?? "").trim()) {
  warnings.push(
    "SHIPPING_PROVIDER is set in .env but is ignored — shipping provider auto-detects from credentials. " +
      "Remove SHIPPING_PROVIDER from .env to avoid confusion."
  );
}

if (!hasDelhiveryEnvKeys && !hasShiprocketEnvKeys) {
  warnings.push(
    "No shipping credentials found in .env — OK for Phase 1. " +
      "Configure Delhivery (DELHIVERY_API_KEY) and/or Shiprocket (SHIPROCKET_EMAIL + SHIPROCKET_PASSWORD) " +
      "via Ops UI before shipping flows. Both can be active simultaneously (dual mode)."
  );
} else {
  if (hasDelhiveryEnvKeys) {
    for (const key of delhiveryEnvKeys) {
      requireKey(key);
      if (/replace_with|change_me/i.test(env[key] ?? "")) {
        errors.push(`${key} still contains placeholder text`);
      }
    }
  }
  if (hasShiprocketEnvKeys) {
    for (const key of shiprocketEnvKeys) {
      requireKey(key);
      if (/replace_with|change_me/i.test(env[key] ?? "")) {
        errors.push(`${key} still contains placeholder text`);
      }
    }
  }
}

if (/replace_with/i.test(env.RESEND_API_KEY ?? "")) {
  warnings.push("RESEND_API_KEY is placeholder — required before ops:newuser on VPS");
}

if (!(env.REPLAY_APPROVAL_TOKEN ?? "").trim()) {
  warnings.push("REPLAY_APPROVAL_TOKEN is not set — analytics replay APIs will fail closed until configured.");
}

if (!(env.OPS_METRICS_TOKEN ?? "").trim()) {
  warnings.push("OPS_METRICS_TOKEN is not set — /ops/metrics will be inaccessible until configured.");
}

const legacyMediaKeys = [
  "MEDIA_STORAGE_PROVIDER",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_BASE_URL",
];
const hasLegacyMediaInEnv = legacyMediaKeys.some((key) => (env[key] ?? "").trim());
if (hasLegacyMediaInEnv) {
  warnings.push(
    "Product media / R2 keys are configured in backend/.env — move them to the Ops config panel (Product Media domain) and remove from .env after restart."
  );
}

if (warnings.length) {
  console.warn("Warnings:");
  for (const w of warnings) console.warn(`  - ${w}`);
}

if (errors.length) {
  console.error("Bootstrap env verification FAILED:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("Bootstrap env verification OK for CLIENT_ID=%s POSTGRES_DB=%s", clientId, postgresDb);
process.exit(0);
