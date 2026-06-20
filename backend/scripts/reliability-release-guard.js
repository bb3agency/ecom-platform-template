#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');

function readReliabilityStateFile() {
  const configuredPath = process.env.RELIABILITY_STATE_FILE?.trim();
  const absolutePath = configuredPath
    ? (path.isAbsolute(configuredPath) ? configuredPath : path.resolve(process.cwd(), configuredPath))
    : path.join(process.cwd(), 'artifacts', 'reliability', 'release-policy-state.json');
  if (!fs.existsSync(absolutePath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(absolutePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    logger.error('Failed to parse reliability state file', { path: absolutePath });
    throw error;
  }
}

function hasApprovedException(state) {
  const approvedFromEnv = String(process.env.RELEASE_EXCEPTION_APPROVED ?? '').toLowerCase() === 'true';
  const approvedFromState = String(state.releaseExceptionApproved ?? '').toLowerCase() === 'true';
  const ticket = process.env.RELEASE_EXCEPTION_TICKET ?? state.releaseExceptionTicket;
  return (approvedFromEnv || approvedFromState) && typeof ticket === 'string' && ticket.trim().length > 0;
}

async function main() {
  const state = readReliabilityStateFile();
  const freezeFromFile = String(state.releaseFreezeActive ?? '').toLowerCase() === 'true';
  const freeze = (process.env.RELEASE_FREEZE_ACTIVE ?? '').toLowerCase() === 'true' || freezeFromFile;
  const hotfix = (process.env.RELEASE_TYPE ?? '').toLowerCase() === 'hotfix';
  const unresolvedCritical = Math.max(
    Number(process.env.CRITICAL_RELIABILITY_INCIDENTS ?? '0'),
    Number(state.criticalReliabilityIncidents ?? '0')
  );
  const releaseDecision = typeof state.releaseDecision === 'string' ? state.releaseDecision : 'approved';

  const approvedException = hasApprovedException(state);
  if ((freeze || unresolvedCritical > 0 || releaseDecision === 'blocked') && !hotfix && !approvedException) {
    logger.error('Release blocked by reliability guardrail: active freeze or unresolved critical incident');
    process.exit(1);
  }

  if (releaseDecision === 'approval_required' && !approvedException && !hotfix) {
    logger.error('Release requires reliability approval because error budget is below approval threshold');
    process.exit(1);
  }

  if (approvedException) {
    logger.success('Reliability release guardrail passed with approved exception workflow');
    return;
  }

  logger.success('Reliability release guardrail passed');
}

main().catch((error) => {
  logger.fatal(error instanceof Error ? error.message : String(error));
});
