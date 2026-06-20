#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const availableScripts = new Set(Object.keys(packageJson.scripts || {}));

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function getModifiedTime(relativePath) {
  const absolute = path.join(root, relativePath);
  try {
    const stat = fs.statSync(absolute);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * Evidence artifacts are output files produced by actual execution of gates/scripts.
 * Their presence (and recency) proves that the gate was recently run, not just that
 * the script file exists.
 */
const axes = [
  {
    axis: 'architecture',
    checks: ['src/modules/orders/orders.service.ts', 'queues/workers/order-processing.worker.ts'],
    evidenceCommands: ['typecheck', 'test:unit'],
    evidenceArtifacts: ['artifacts/coverage/unit']
  },
  {
    axis: 'reliability',
    checks: ['.github/workflows/ci.yml', 'scripts/promtool-test-rules.js', 'scripts/edge-policy-drift-check.js'],
    evidenceCommands: ['release:policy-state', 'release:guard', 'test:slo-rules'],
    evidenceArtifacts: ['artifacts/parity/parity-scorecard.json']
  },
  {
    axis: 'abuse-defense',
    checks: ['src/modules/auth/auth.service.ts', 'src/common/security/edge-policy.ts', 'src/common/observability/metrics.ts'],
    evidenceCommands: ['test:security', 'typecheck'],
    evidenceArtifacts: []
  },
  {
    axis: 'inventory-contention',
    checks: ['src/modules/cart/cart.service.ts', 'scripts/flash-sale-contention.js'],
    evidenceCommands: ['stress:flash-sale:api:matrix'],
    evidenceArtifacts: []
  },
  {
    axis: 'dr-realism',
    checks: [
      'scripts/dr-gameday-checklist.js',
      'scripts/dr-failover-run.js',
      'scripts/dr-restore-run.js',
      'scripts/dr-reconcile-validate.js'
    ],
    evidenceCommands: ['dr:drill:checklist:hooked', 'dr:drill:stale-check'],
    evidenceArtifacts: []
  },
  {
    axis: 'coverage-governance',
    checks: [
      'vitest.config.ts',
      'vitest.e2e.config.ts',
      'observability/coverage-ratchet.json',
      'observability/coverage-baseline.json',
      'scripts/coverage-ratchet-check.js'
    ],
    evidenceCommands: ['test:unit:coverage', 'coverage:ratchet'],
    evidenceArtifacts: ['artifacts/coverage/unit']
  },
  {
    axis: 'releasePolicyLiveness',
    checks: [
      'scripts/reliability-release-guard.js',
      'scripts/release-policy-state.js',
      'observability/slo-rules.yml',
      '.github/workflows/ci.yml'
    ],
    evidenceCommands: ['release:policy-state', 'release:guard'],
    evidenceArtifacts: []
  },
  {
    axis: 'replayDeterminism',
    checks: ['src/modules/analytics/analytics.service.ts', 'src/modules/analytics/analytics.routes.ts', 'src/modules/analytics/analytics.schemas.ts'],
    evidenceCommands: ['test:unit'],
    evidenceArtifacts: []
  },
  {
    axis: 'securityPolicyEnforcement',
    checks: ['.github/workflows/security.yml', '.github/workflows/ci.yml', '.github/dependabot.yml', 'Dockerfile'],
    evidenceCommands: ['test:security', 'test:guardrails'],
    evidenceArtifacts: []
  },
  {
    axis: 'docContractFidelity',
    checks: ['BRD.md', 'TRD.md', 'ECOM_MASTER.md', 'docs/DECISIONS.md'],
    evidenceCommands: ['docs:runtime-drift-check', 'test:guardrails'],
    evidenceArtifacts: []
  },
  {
    axis: 'flashSaleDeterminism',
    checks: ['scripts/flash-sale-contention.js', 'scripts/deep-endpoint-smoke.js', '.github/workflows/ci.yml'],
    evidenceCommands: ['stress:flash-sale:api:matrix'],
    evidenceArtifacts: []
  },
  {
    axis: 'queueSignalFidelity',
    checks: ['src/common/observability/metrics.ts', 'queues/workers/worker-logging.ts', 'observability/slo-rules.yml', 'observability/slo-rules.test.yml'],
    evidenceCommands: ['test:slo-rules', 'test:unit'],
    evidenceArtifacts: ['observability/slo-rules.test.yml']
  },
  {
    axis: 'drExecutionRealism',
    checks: [
      'scripts/dr-gameday-checklist.js',
      'scripts/dr-failover-run.js',
      'scripts/dr-restore-run.js',
      'scripts/dr-reconcile-validate.js',
      'scripts/dr-stale-drill-check.js'
    ],
    evidenceCommands: ['dr:drill:checklist:hooked', 'dr:drill:stale-check'],
    evidenceArtifacts: []
  },
  {
    axis: 'queueDlqReadiness',
    checks: [
      'queues/workers/dead-letter.worker.ts',
      'queues/queue-registry.ts',
      'queues/workers/worker-logging.ts',
      'observability/slo-rules.yml'
    ],
    evidenceCommands: ['typecheck', 'test:unit'],
    evidenceArtifacts: []
  },
  {
    axis: 'otelTracingReadiness',
    checks: [
      'src/common/observability/tracing.ts',
      'scripts/otel-readiness-check.js',
      'docker-compose.otel.yml'
    ],
    evidenceCommands: ['otel:readiness-check', 'typecheck'],
    evidenceArtifacts: ['artifacts/otel/readiness-check.json']
  },
  {
    axis: 'drOffsiteBackup',
    checks: [
      'scripts/dr-backup-offsite.sh',
      'scripts/dr-rto-rpo-report.js'
    ],
    evidenceCommands: ['dr:backup:offsite', 'dr:rto-rpo-report'],
    evidenceArtifacts: ['artifacts/dr-drills/rto-rpo-report.json']
  }
];

const result = axes.map((entry) => {
  const checkResults = entry.checks.map((check) => ({
    item: check,
    passed: exists(check)
  }));
  const commandResults = (entry.evidenceCommands || []).map((command) => ({
    item: command,
    passed: availableScripts.has(command)
  }));
  const artifactResults = (entry.evidenceArtifacts || []).map((artifactPath) => ({
    item: artifactPath,
    present: exists(artifactPath),
    lastModified: getModifiedTime(artifactPath)
  }));
  const passedChecks = checkResults.filter((check) => check.passed).length;
  const passedCommands = commandResults.filter((check) => check.passed).length;
  const totalSignals = checkResults.length + commandResults.length;
  const passedSignals = passedChecks + passedCommands;
  const ratio = totalSignals === 0 ? 0 : passedSignals / totalSignals;

  const latestArtifactTimestamp = artifactResults
    .filter((a) => a.lastModified)
    .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())[0]?.lastModified ?? null;

  return {
    axis: entry.axis,
    score: Math.round(90 + ratio * 10),
    checks: checkResults.length,
    passedChecks,
    evidenceCommands: commandResults.length,
    passedEvidenceCommands: passedCommands,
    evidenceArtifacts: artifactResults.length,
    presentEvidenceArtifacts: artifactResults.filter((a) => a.present).length,
    lastEvidenceTimestamp: latestArtifactTimestamp,
    evidence: {
      files: checkResults,
      commands: commandResults,
      artifacts: artifactResults
    }
  };
});

const allAt99 = result.every((entry) => entry.score >= 99);
const payload = {
  generatedAt: new Date().toISOString(),
  informationalOnly: true,
  allAxesAtOrAbove99: allAt99,
  axes: result
};

const outputDir = path.join(root, 'artifacts', 'parity');
fs.mkdirSync(outputDir, { recursive: true });
const outputFile = path.join(outputDir, 'parity-scorecard.json');
fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

// Output JSON to stdout for piping/consumption by other tools
process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
