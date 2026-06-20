#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');

const root = process.cwd();
const summaryPath = path.join(root, 'artifacts', 'coverage', 'unit', 'coverage-summary.json');
const configPath = path.join(root, 'observability', 'coverage-ratchet.json');
const baselinePath = path.join(root, 'observability', 'coverage-baseline.json');
const allowBaselineUpdate = String(process.env.COVERAGE_BASELINE_UPDATE ?? 'false').toLowerCase() === 'true';

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function aggregateDomain(summary, includePrefixes) {
  const entries = Object.entries(summary).filter(([key]) => key !== 'total');
  const normalizedPrefixes = includePrefixes.map((prefix) => prefix.replace(/\\/g, '/'));
  const matched = entries.filter(([filePath]) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return normalizedPrefixes.some((prefix) => normalizedPath.includes(prefix));
  });
  if (matched.length === 0) {
    return { linesPct: 0, covered: 0, total: 0 };
  }

  let covered = 0;
  let total = 0;
  for (const [, metrics] of matched) {
    const lineMetrics = metrics.lines;
    covered += Number(lineMetrics.covered ?? 0);
    total += Number(lineMetrics.total ?? 0);
  }

  return {
    linesPct: total > 0 ? Number(((covered / total) * 100).toFixed(2)) : 0,
    covered,
    total
  };
}

function main() {
  const summary = readJson(summaryPath);
  const config = readJson(configPath);
  const baseline = fs.existsSync(baselinePath) ? readJson(baselinePath) : null;
  const failures = [];
  const domainResults = [];

  const totalLinesPct = Number(summary.total?.lines?.pct ?? 0);
  if (totalLinesPct < Number(config.globalMinLinesPct ?? 0)) {
    failures.push(
      `Global lines coverage ${totalLinesPct}% is below floor ${config.globalMinLinesPct}%`
    );
  }
  if (baseline && totalLinesPct + 0.0001 < Number(baseline.globalLinesPct ?? 0)) {
    failures.push(
      `Global lines coverage ${totalLinesPct}% regressed below baseline ${baseline.globalLinesPct}%`
    );
  }

  for (const domain of config.domains ?? []) {
    const result = aggregateDomain(summary, domain.includePrefixes ?? []);
    domainResults.push({
      domain: domain.name,
      linesPct: result.linesPct,
      minLinesPct: domain.minLinesPct
    });
    if (result.linesPct < Number(domain.minLinesPct ?? 0)) {
      failures.push(
        `Domain ${domain.name} lines coverage ${result.linesPct}% is below floor ${domain.minLinesPct}%`
      );
    }
    const baselineDomain = Number(baseline?.domains?.[domain.name] ?? 0);
    if (baseline && result.linesPct + 0.0001 < baselineDomain) {
      failures.push(
        `Domain ${domain.name} coverage ${result.linesPct}% regressed below baseline ${baselineDomain}%`
      );
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    globalLinesPct: totalLinesPct,
    domainResults,
    failures
  };

  const artifactDir = path.join(root, 'artifacts', 'coverage');
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, 'ratchet-report.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  if (allowBaselineUpdate) {
    const baselinePayload = {
      globalLinesPct: totalLinesPct,
      domains: Object.fromEntries(domainResults.map((result) => [result.domain, result.linesPct]))
    };
    fs.writeFileSync(baselinePath, `${JSON.stringify(baselinePayload, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  if (failures.length > 0) {
    process.exit(1);
  }
}

main();
