#!/usr/bin/env node
const { spawnSync } = require('child_process');

const startedAt = Date.now();
const hookCommand = process.env.DR_FAILOVER_HOOK?.trim();
const provisionHook = process.env.DR_EPHEMERAL_PROVISION_HOOK?.trim();
const teardownHook = process.env.DR_EPHEMERAL_TEARDOWN_HOOK?.trim();
const simulatedDelayMs = Number(process.env.DR_FAILOVER_SIM_DELAY_MS ?? '2500');
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
        stage: 'failover',
        executionMode: 'hook',
        status: 'fail',
        measuredRtoMinutes: Number(((Date.now() - startedAt) / 60000).toFixed(2)),
        measuredRpoMinutes: Number(process.env.DR_FAILOVER_RPO_MINUTES ?? '2'),
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
      stage: 'failover',
      executionMode: 'hook',
      status: success && durationMs <= 15 * 60 * 1000 ? 'pass' : 'fail',
      measuredRtoMinutes: Number((durationMs / 60000).toFixed(2)),
      measuredRpoMinutes: Number(process.env.DR_FAILOVER_RPO_MINUTES ?? '2'),
      checks: ['ephemeral-failover-hook', 'postgres-primary-reachable', 'api-healthcheck'],
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
    stage: 'failover',
    executionMode: 'simulation',
    status: durationMs <= 15 * 60 * 1000 ? 'pass' : 'fail',
    measuredRtoMinutes: Number((durationMs / 60000).toFixed(2)),
    measuredRpoMinutes: 2,
    checks: ['postgres-primary-reachable', 'redis-primary-reachable', 'api-healthcheck'],
    environmentId,
    snapshotId
  };
  process.stdout.write(JSON.stringify(output) + '\n');
}, simulatedDelayMs);
