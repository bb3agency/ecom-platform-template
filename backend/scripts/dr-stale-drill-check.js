#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');

const thresholdDays = Number(process.env.DR_DRILL_STALE_DAYS ?? '90');
const evidenceDir = path.join(process.cwd(), 'artifacts', 'dr-drills');

if (!fs.existsSync(evidenceDir)) {
  logger.error('No DR drill evidence found');
  process.exit(1);
}

const files = fs
  .readdirSync(evidenceDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => ({
    file,
    mtimeMs: fs.statSync(path.join(evidenceDir, file)).mtimeMs
  }))
  .sort((a, b) => b.mtimeMs - a.mtimeMs);

if (files.length === 0) {
  logger.error('No DR drill evidence files found');
  process.exit(1);
}

const newest = files[0];
const ageDays = (Date.now() - newest.mtimeMs) / (1000 * 60 * 60 * 24);
if (ageDays > thresholdDays) {
  logger.error(`DR drill evidence is stale (${ageDays.toFixed(1)} days). Threshold is ${thresholdDays} days`);
  process.exit(1);
}

const latestPath = path.join(evidenceDir, newest.file);
const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
const stages = Array.isArray(latest.stages) ? latest.stages : [];
if (stages.length === 0) {
  logger.error('Latest DR drill artifact is missing stages data');
  process.exit(1);
}
const requiredFields = ['environmentId', 'snapshotId'];
for (const field of requiredFields) {
  if (!latest.orchestration || typeof latest.orchestration[field] !== 'string' || latest.orchestration[field].trim().length === 0) {
    logger.error(`Latest DR drill artifact is missing orchestration.${field}`);
    process.exit(1);
  }
}
const requireHookInProduction = String(process.env.DR_ORCHESTRATION_PROFILE ?? '').toLowerCase() === 'production-like';
if (requireHookInProduction) {
  const nonHook = stages.filter((stage) => stage.stage !== 'rollback-validation' && stage.executionMode !== 'hook');
  if (nonHook.length > 0) {
    logger.error(`Production-like drill artifact contains non-hook stages: ${nonHook.map((stage) => stage.stage).join(', ')}`);
    process.exit(1);
  }
}
const failedStages = stages.filter((stage) => !String(stage.status ?? '').includes('pass'));
if (failedStages.length > 0) {
  logger.error(`Latest DR drill artifact contains failed stages: ${failedStages.map((stage) => stage.stage).join(', ')}`);
  process.exit(1);
}

logger.success(`DR drill evidence freshness and integrity check passed (${ageDays.toFixed(1)} days old)`);
