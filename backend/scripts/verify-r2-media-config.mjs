#!/usr/bin/env node
/**
 * Preflight: product media should be configured via Ops DB overlay, not bootstrap .env.
 * Usage: node scripts/verify-r2-media-config.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env");

const legacyKeys = [
  "MEDIA_STORAGE_PROVIDER",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_BASE_URL",
];

if (!existsSync(envPath)) {
  console.log("R2 media preflight skipped (no backend/.env)");
  process.exit(0);
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

const found = legacyKeys.filter((key) => (env[key] ?? "").trim());
if (found.length > 0) {
  console.error("R2 media preflight FAILED: configure via Ops panel, not .env:");
  for (const key of found) console.error(`  - remove or migrate ${key}`);
  console.error("After saving in Ops UI, restart API/workers and verify GET /api/v1/health/ready.");
  process.exit(1);
}

console.log("R2 media preflight OK (no legacy R2 keys in backend/.env — use Ops config panel)");
process.exit(0);
