#!/usr/bin/env node

/**
 * DR RTO/RPO Report Generator
 *
 * Reads drill evidence files from artifacts/dr-drills/ and produces a
 * pass/fail report comparing measured RTO/RPO against targets.
 *
 * Usage: node scripts/dr-rto-rpo-report.js
 * Exit 0 = all targets met, Exit 1 = some targets breached
 */

const fs = require('node:fs');
const path = require('node:path');
const logger = require('./lib/logger');

const DRILLS_DIR = path.join(process.cwd(), 'artifacts', 'dr-drills');
const REPORT_PATH = path.join(DRILLS_DIR, 'rto-rpo-report.json');
const STALE_THRESHOLD_DAYS = 30;

// RTO/RPO targets per stage (minutes)
const TARGETS = {
  'backup-restore': { rtoMinutes: 30, rpoMinutes: 60 },
  'failover':       { rtoMinutes: 15, rpoMinutes: 30 },
  'reconciliation': { rtoMinutes: 10, rpoMinutes: 15 },
  'full-drill':     { rtoMinutes: 30, rpoMinutes: 60 }
};

function main() {
  if (!fs.existsSync(DRILLS_DIR)) {
    logger.warn(`No drill evidence directory found at: ${DRILLS_DIR}`);
    logger.info('Run DR drills first to generate evidence.');
    writeReport({ stages: [], overallPass: false, timestamp: new Date().toISOString() });
    process.exit(1);
  }

  const files = fs.readdirSync(DRILLS_DIR).filter(f => f.startsWith('drill-') && f.endsWith('.json'));

  if (files.length === 0) {
    logger.warn('No drill evidence files found (drill-*.json)');
    writeReport({ stages: [], overallPass: false, timestamp: new Date().toISOString() });
    process.exit(1);
  }

  // Group drills by stage, keeping the latest per stage
  const latestByStage = new Map();
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DRILLS_DIR, file), 'utf8'));
      const stage = data.stage || data.type || 'unknown';
      const existing = latestByStage.get(stage);
      if (!existing || (data.timestamp && data.timestamp > existing.timestamp)) {
        latestByStage.set(stage, { ...data, _file: file });
      }
    } catch {
      // Skip malformed evidence files
    }
  }

  const now = Date.now();
  const stages = [];
  let overallPass = true;

  logger.section('DR RTO/RPO Report');
  logger.info('Stage                 | RTO Target | RTO Actual | RPO Target | RPO Actual | Stale? | Pass');
  logger.info('----------------------|------------|------------|------------|------------|--------|-----');

  for (const [stage, drill] of latestByStage.entries()) {
    const target = TARGETS[stage] || { rtoMinutes: 30, rpoMinutes: 60 };
    const measuredRto = drill.measuredRtoMinutes ?? drill.rtoMinutes ?? null;
    const measuredRpo = drill.measuredRpoMinutes ?? drill.rpoMinutes ?? null;

    const drillDate = drill.timestamp ? new Date(drill.timestamp) : null;
    const ageDays = drillDate ? Math.floor((now - drillDate.getTime()) / (1000 * 60 * 60 * 24)) : Infinity;
    const isStale = ageDays > STALE_THRESHOLD_DAYS;

    const rtoPass = measuredRto !== null && measuredRto <= target.rtoMinutes;
    const rpoPass = measuredRpo !== null && measuredRpo <= target.rpoMinutes;
    const stagePass = rtoPass && rpoPass && !isStale;

    if (!stagePass) overallPass = false;

    const rtoStr = measuredRto !== null ? `${measuredRto}m` : 'n/a';
    const rpoStr = measuredRpo !== null ? `${measuredRpo}m` : 'n/a';
    const icon = stagePass ? '✅' : '❌';

    const status = stagePass ? 'PASS' : 'FAIL';
    const staleStr = isStale ? 'YES' : 'NO';
    logger.info(`${stage.padEnd(20)} | ${(target.rtoMinutes + 'm').padEnd(10)} | ${rtoStr.padEnd(10)} | ${(target.rpoMinutes + 'm').padEnd(10)} | ${rpoStr.padEnd(10)} | ${staleStr.padEnd(6)} | ${status}`);

    stages.push({
      stage,
      target,
      measured: { rtoMinutes: measuredRto, rpoMinutes: measuredRpo },
      drillTimestamp: drill.timestamp || null,
      ageDays,
      isStale,
      rtoPass,
      rpoPass,
      pass: stagePass,
      evidenceFile: drill._file
    });
  }

  // Check for missing stages
  for (const stage of Object.keys(TARGETS)) {
    if (!latestByStage.has(stage)) {
      logger.error(`${stage.padEnd(20)} | — no drill evidence found —`);
      stages.push({
        stage,
        target: TARGETS[stage],
        measured: { rtoMinutes: null, rpoMinutes: null },
        drillTimestamp: null,
        ageDays: Infinity,
        isStale: true,
        rtoPass: false,
        rpoPass: false,
        pass: false,
        evidenceFile: null
      });
      overallPass = false;
    }
  }

  if (overallPass) {
    logger.success('Overall: ALL TARGETS MET');
  } else {
    logger.error('Overall: SOME TARGETS BREACHED');
  }

  const report = {
    timestamp: new Date().toISOString(),
    overallPass,
    staleThresholdDays: STALE_THRESHOLD_DAYS,
    stages
  };

  writeReport(report);
  process.exit(overallPass ? 0 : 1);
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  logger.info(`Report written to: ${REPORT_PATH}`);
}

main();
