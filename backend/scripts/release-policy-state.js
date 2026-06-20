#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');

const stateFile = process.env.RELIABILITY_STATE_FILE?.trim()
  ? path.resolve(process.cwd(), process.env.RELIABILITY_STATE_FILE.trim())
  : path.join(process.cwd(), 'artifacts', 'reliability', 'release-policy-state.json');

const mode = (process.env.RELEASE_POLICY_MODE ?? 'auto').trim().toLowerCase();
const staticConsumedPercent = Number(process.env.ERROR_BUDGET_CONSUMED_PERCENT ?? '0');
const freezeThresholdPercent = Number(process.env.ERROR_BUDGET_FREEZE_THRESHOLD_PERCENT ?? '75');
const thawThresholdPercent = Number(process.env.ERROR_BUDGET_THAW_THRESHOLD_PERCENT ?? '35');
const approvalThresholdPercent = Number(process.env.ERROR_BUDGET_APPROVAL_THRESHOLD_PERCENT ?? '25');
const blockThresholdPercent = Number(process.env.ERROR_BUDGET_BLOCK_THRESHOLD_PERCENT ?? '10');
const prometheusBaseUrl = process.env.PROMETHEUS_BASE_URL?.trim();
const prometheusQuery = process.env.PROMETHEUS_ERROR_BUDGET_QUERY?.trim()
  ?? '100 - (max(slo:error_budget_consumed_percent) or vector(0))';
const queryTimeoutMs = Number(process.env.PROMETHEUS_QUERY_TIMEOUT_MS ?? '5000');

function isReleaseBranch() {
  const ref = process.env.GITHUB_REF?.toLowerCase() ?? '';
  return ref.endsWith('/main') || ref.endsWith('/master') || ref.includes('/release/');
}

function loadExisting() {
  if (!fs.existsSync(stateFile)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

async function queryLiveErrorBudgetRemaining() {
  if (!prometheusBaseUrl) {
    throw new Error('PROMETHEUS_BASE_URL is required for live release policy mode');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), queryTimeoutMs);
  try {
    const url = new URL('/api/v1/query', prometheusBaseUrl);
    url.searchParams.set('query', prometheusQuery);
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Prometheus query failed with status ${response.status}`);
    }
    const payload = await response.json();
    const value = payload?.data?.result?.[0]?.value?.[1];
    const remainingPercent = Number(value);
    if (!Number.isFinite(remainingPercent)) {
      throw new Error('Prometheus query returned a non-numeric value');
    }
    return Math.max(0, Math.min(100, remainingPercent));
  } finally {
    clearTimeout(timer);
  }
}

function resolveReleaseDecision(errorBudgetRemainingPercent, releaseType) {
  if (releaseType === 'hotfix') {
    return 'approved';
  }
  if (errorBudgetRemainingPercent <= blockThresholdPercent) {
    return 'blocked';
  }
  if (errorBudgetRemainingPercent <= approvalThresholdPercent) {
    return 'approval_required';
  }
  return 'approved';
}

function main() {
  return run().catch((error) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

async function run() {
  const existing = loadExisting();
  const releaseType = (process.env.RELEASE_TYPE ?? 'standard').toLowerCase();
  let errorBudgetRemainingPercent = Number(existing.errorBudgetRemainingPercent ?? 100);
  let source = 'state';
  let sourceError = null;
  const liveRequired = mode === 'live_required';
  const shouldUseLive = mode === 'live' || mode === 'auto' || liveRequired;

  if (shouldUseLive) {
    try {
      errorBudgetRemainingPercent = await queryLiveErrorBudgetRemaining();
      source = 'prometheus';
    } catch (error) {
      sourceError = error instanceof Error ? error.message : String(error);
      if (mode === 'live' || liveRequired) {
        throw error;
      }
      source = 'env-fallback';
      errorBudgetRemainingPercent = Math.max(0, Math.min(100, 100 - staticConsumedPercent));
    }
  } else {
    source = 'env';
    errorBudgetRemainingPercent = Math.max(0, Math.min(100, 100 - staticConsumedPercent));
  }

  const consumedPercent = Number((100 - errorBudgetRemainingPercent).toFixed(2));
  const currentlyFrozen = String(existing.releaseFreezeActive ?? '').toLowerCase() === 'true';
  let nextFrozen = currentlyFrozen;
  let transition = 'none';

  if (!currentlyFrozen && consumedPercent >= freezeThresholdPercent) {
    nextFrozen = true;
    transition = 'freeze';
  } else if (currentlyFrozen && consumedPercent <= thawThresholdPercent) {
    nextFrozen = false;
    transition = 'unfreeze';
  }
  const decision = resolveReleaseDecision(errorBudgetRemainingPercent, releaseType);

  const payload = {
    ...existing,
    updatedAt: new Date().toISOString(),
    mode,
    releaseBranch: isReleaseBranch(),
    liveTelemetryRequired: liveRequired,
    source,
    ...(sourceError ? { sourceError } : {}),
    errorBudgetConsumedPercent: consumedPercent,
    errorBudgetRemainingPercent,
    freezeThresholdPercent,
    thawThresholdPercent,
    approvalThresholdPercent,
    blockThresholdPercent,
    releaseType,
    releaseDecision: decision,
    releaseFreezeActive: nextFrozen,
    transition,
    queriedAt: new Date().toISOString(),
    ...(source === 'prometheus' ? { prometheusQuery } : {})
  };

  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  // Output JSON to stdout for piping/consumption by other tools
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

main();
