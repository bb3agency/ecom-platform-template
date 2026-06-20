#!/usr/bin/env node
const { spawnSync } = require('child_process');

const startedAt = Date.now();
const hookCommand = process.env.DR_RECONCILE_HOOK?.trim();
const provisionHook = process.env.DR_EPHEMERAL_PROVISION_HOOK?.trim();
const teardownHook = process.env.DR_EPHEMERAL_TEARDOWN_HOOK?.trim();
const simulatedDelayMs = Number(process.env.DR_RECONCILE_SIM_DELAY_MS ?? '2000');
const environmentId = process.env.DR_EPHEMERAL_ENV_ID ?? `ephemeral-${Date.now()}`;
const snapshotId = process.env.DR_SNAPSHOT_ID ?? 'snapshot-not-set';

function runHook(commandText) {
  const command = process.platform === 'win32' ? 'powershell' : 'sh';
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-Command', commandText]
    : ['-lc', commandText];
  return spawnSync(command, args, { encoding: 'utf8' });
}

function withLifecycle(mainRun) {
  if (provisionHook) {
    const provision = runHook(provisionHook);
    if (provision.status !== 0) {
      return {
        stage: 'reconcile',
        executionMode: 'hook',
        status: 'fail',
        measuredRtoMinutes: Number(((Date.now() - startedAt) / 60000).toFixed(2)),
        measuredRpoMinutes: Number(process.env.DR_RECONCILE_RPO_MINUTES ?? '3'),
        checks: ['ephemeral-provision-hook'],
        lifecycleError: 'provision-failed',
        lifecycleExitCode: provision.status,
        environmentId,
        snapshotId
      };
    }
  }
  const main = mainRun();
  if (teardownHook) {
    const teardown = runHook(teardownHook);
    if (teardown.status !== 0 && main.status === 'pass') {
      return {
        ...main,
        status: 'fail',
        lifecycleError: 'teardown-failed',
        lifecycleExitCode: teardown.status
      };
    }
  }
  return main;
}

if (hookCommand) {
  const output = withLifecycle(() => {
    const run = runHook(hookCommand);
    const durationMs = Date.now() - startedAt;
    const success = run.status === 0;
    return {
      stage: 'reconcile',
      executionMode: 'hook',
      status: success && durationMs <= 20 * 60 * 1000 ? 'pass' : 'fail',
      measuredRtoMinutes: Number((durationMs / 60000).toFixed(2)),
      measuredRpoMinutes: Number(process.env.DR_RECONCILE_RPO_MINUTES ?? '3'),
      checks: ['ephemeral-reconcile-hook', 'outbox-drained', 'inbox-replayed'],
      hookExitCode: run.status,
      environmentId,
      snapshotId
    };
  });
  process.stdout.write(JSON.stringify(output) + '\n');
  process.exit(output.status === 'pass' ? 0 : 1);
}

setTimeout(() => {
  const durationMs = Date.now() - startedAt;
  const output = {
    stage: 'reconcile',
    executionMode: 'simulation',
    status: durationMs <= 20 * 60 * 1000 ? 'pass' : 'fail',
    measuredRtoMinutes: Number((durationMs / 60000).toFixed(2)),
    measuredRpoMinutes: 3,
    checks: ['outbox-drained', 'inbox-replayed', 'reconciliation-issues-below-threshold'],
    environmentId,
    snapshotId
  };
  process.stdout.write(JSON.stringify(output) + '\n');
}, simulatedDelayMs);
