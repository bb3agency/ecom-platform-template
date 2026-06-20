#!/usr/bin/env node
/**
 * Validates repository artifacts required for VPS deploy (no live VPS connection).
 * Usage: node scripts/verify-vps-deploy-preflight.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "docker-compose.yml",
  "scripts/vps-deploy.sh",
  "scripts/vps-frontend-deploy.sh",
  "nginx/client.conf.template",
  "nginx/rate-zones.conf.template",
  "nginx/maintenance.html",
  ".github/workflows/deploy.yml",
  ".github/workflows/ci.yml",
  "docs/CLIENT_VPS_SETUP_GUIDE.md",
  "docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md",
  "docs/BACKEND_GO_LIVE_CHECKLIST.md",
];

const monorepoWorkflows = [
  "../.github/workflows/reliability-ci.yml",
  "../.github/workflows/deploy.yml",
];

const errors = [];

for (const rel of requiredFiles) {
  const abs = resolve(root, rel);
  if (!existsSync(abs)) {
    errors.push(`Missing required file: ${rel}`);
  }
}

for (const rel of monorepoWorkflows) {
  const abs = resolve(root, rel);
  if (!existsSync(abs)) {
    errors.push(`Missing monorepo workflow (push-to-deploy will not run): ${rel}`);
  }
}

const deploySh = resolve(root, "scripts/vps-deploy.sh");
if (existsSync(deploySh)) {
  const content = readFileSync(deploySh, "utf8");
  for (const needle of [
    "CLIENT_PATH",
    "prisma migrate deploy",
    "/api/v1/health",
    "/api/v1/health/ready",
    "runtimeConfigMissingKeys",
    "docker compose -p",
  ]) {
    if (!content.includes(needle)) {
      errors.push(`vps-deploy.sh missing expected step: ${needle}`);
    }
  }
}

const frontendDeploySh = resolve(root, "scripts/vps-frontend-deploy.sh");
if (existsSync(frontendDeploySh)) {
  const content = readFileSync(frontendDeploySh, "utf8");
  const shebangCount = (content.match(/^#!\/usr\/bin\/env bash/gm) ?? []).length;
  if (shebangCount !== 1) {
    errors.push(`vps-frontend-deploy.sh should contain exactly one shebang (found ${shebangCount})`);
  }
  for (const needle of ["npm ci", "pm2 reload", "resolve_storefront_port"]) {
    if (!content.includes(needle)) {
      errors.push(`vps-frontend-deploy.sh missing expected step: ${needle}`);
    }
  }
}

const compose = resolve(root, "docker-compose.yml");
if (existsSync(compose)) {
  const content = readFileSync(compose, "utf8");
  if (!content.includes("${CLIENT_ID")) {
    errors.push("docker-compose.yml should parameterize CLIENT_ID for container names");
  }
}

if (errors.length) {
  console.error("VPS deploy preflight FAILED:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("VPS deploy preflight OK — all repository artifacts present.");
process.exit(0);
