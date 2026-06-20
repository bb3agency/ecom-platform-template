#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require('child_process');
const path = require('path');

const env = {
  ...process.env,
  DR_REQUIRE_HOOK: 'true',
  DR_ORCHESTRATION_PROFILE: process.env.DR_ORCHESTRATION_PROFILE ?? 'production-like',
  DR_EPHEMERAL_PROVISION_HOOK: 'node scripts/dr-ephemeral-pack.js provision',
  DR_EPHEMERAL_TEARDOWN_HOOK: 'node scripts/dr-ephemeral-pack.js teardown',
  DR_FAILOVER_HOOK: 'node scripts/dr-ephemeral-pack.js failover',
  DR_RESTORE_HOOK: 'node scripts/dr-ephemeral-pack.js restore',
  DR_RECONCILE_HOOK: 'node scripts/dr-ephemeral-pack.js reconcile'
};

const script = path.join(__dirname, 'dr-gameday-checklist.js');
const run = spawnSync(process.execPath, [script], { env, stdio: 'inherit' });
process.exit(run.status ?? 1);
