#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const logger = require('./lib/logger');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'artifacts', 'dr-drills');
const now = new Date();
const mode = process.argv[2] ?? 'full';
const requireHookExecution = String(process.env.DR_REQUIRE_HOOK ?? 'false').toLowerCase() === 'true';

const stages = [
  { name: 'failover-execution', owner: 'platform-oncall', targetRtoMinutes: 15, targetRpoMinutes: 5, script: 'dr-failover-run.js' },
  { name: 'restore-execution', owner: 'db-oncall', targetRtoMinutes: 30, targetRpoMinutes: 10, script: 'dr-restore-run.js' },
  { name: 'reconciliation-catchup', owner: 'backend-oncall', targetRtoMinutes: 20, targetRpoMinutes: 15, script: 'dr-reconcile-validate.js' },
  { name: 'rollback-validation', owner: 'release-oncall', targetRtoMinutes: 20, targetRpoMinutes: 0 }
];

const selectedStages = mode === 'full' ? stages : stages.filter((stage) => stage.name === mode);
if (selectedStages.length === 0) {
  logger.error(`Unknown drill mode '${mode}'. Use 'full' or one of: ${stages.map((stage) => stage.name).join(', ')}`);
  process.exit(1);
}

fs.mkdirSync(evidenceDir, { recursive: true });

const stageResults = selectedStages.map((stage) => {
  const startedAt = new Date().toISOString();
  let measuredRtoMinutes = stage.targetRtoMinutes;
  let measuredRpoMinutes = stage.targetRpoMinutes;
  let status = 'simulated-pass';
  let integrityChecks = ['stage-not-executed'];
  let executionMode = 'simulation';

  if (stage.script) {
    const scriptPath = path.join(root, 'scripts', stage.script);
    const run = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8' });
    if (run.status === 0 && run.stdout) {
      try {
        const payload = JSON.parse(run.stdout.trim());
        measuredRtoMinutes = Number(payload.measuredRtoMinutes ?? measuredRtoMinutes);
        measuredRpoMinutes = Number(payload.measuredRpoMinutes ?? measuredRpoMinutes);
        status = payload.status === 'pass' ? 'executed-pass' : 'executed-fail';
        executionMode = payload.executionMode === 'hook' ? 'hook' : 'simulation';
        integrityChecks = Array.isArray(payload.checks) ? payload.checks : integrityChecks;
      } catch {
        status = 'executed-fail';
        integrityChecks = ['invalid-stage-payload'];
      }
    } else {
      status = 'executed-fail';
      integrityChecks = ['stage-script-failed'];
    }
  }

  return {
    stage: stage.name,
    owner: stage.owner,
    startedAt,
    endedAt: new Date().toISOString(),
    targetRtoMinutes: stage.targetRtoMinutes,
    targetRpoMinutes: stage.targetRpoMinutes,
    measuredRtoMinutes,
    measuredRpoMinutes,
    executionMode,
    status,
    integrityChecks,
    unresolvedRisks: [],
    remediationLinks: []
  };
});

const evidence = {
  generatedAt: now.toISOString(),
  mode,
  orchestration: {
    profile: process.env.DR_ORCHESTRATION_PROFILE ?? 'local-sim',
    environmentId: process.env.DR_EPHEMERAL_ENV_ID ?? 'not-set',
    snapshotId: process.env.DR_SNAPSHOT_ID ?? 'not-set'
  },
  startedAt: now.toISOString(),
  endedAt: new Date().toISOString(),
  stages: stageResults,
  rollbackResult: stageResults.find((stage) => stage.stage === 'rollback-validation')?.status ?? 'unknown',
  invariants: {
    allStagesPass: stageResults.every((stage) => String(stage.status).includes('pass')),
    hookExecutedStages: stageResults
      .filter((stage) => stage.stage !== 'rollback-validation')
      .every((stage) => stage.executionMode === 'hook')
  }
};

if (requireHookExecution) {
  const nonHook = stageResults.filter((stage) => stage.stage !== 'rollback-validation' && stage.executionMode !== 'hook');
  if (nonHook.length > 0) {
    logger.error(`DR hook-mode enforcement failed for stages: ${nonHook.map((stage) => stage.stage).join(', ')}`);
    process.exit(1);
  }
}

const outputFile = path.join(
  evidenceDir,
  `drill-${now.toISOString().replace(/[:.]/g, '-')}.json`
);
fs.writeFileSync(outputFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

logger.success('DR drill simulation completed');
logger.info(`Evidence file: ${outputFile}`);
for (const stage of stageResults) {
  logger.info(
    `- ${stage.stage}: ${stage.status} rto=${stage.measuredRtoMinutes}m rpo=${stage.measuredRpoMinutes}m owner=${stage.owner}`
  );
}
