#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');

const root = path.resolve(__dirname, '..');
const testsFile = path.join(root, 'observability', 'slo-rules.test.yml');
const localPromtool = path.join(root, '.tools', 'promtool', process.platform === 'win32' ? 'promtool.exe' : 'promtool');

function resolvePromtoolBinary() {
  const explicit = process.env.PROMTOOL_BIN?.trim();
  if (explicit) {
    return explicit;
  }
  if (fs.existsSync(localPromtool)) {
    return localPromtool;
  }
  return 'promtool';
}

const promtool = resolvePromtoolBinary();

function runLocalFallbackRulesCheck() {
  if (!fs.existsSync(testsFile)) {
    logger.error(`Missing SLO rule test file: ${testsFile}`);
    return 1;
  }

  const content = fs.readFileSync(testsFile, 'utf8');
  const requiredTokens = ['rule_files:', 'tests:', 'eval_time:', 'alertname:', 'exp_alerts:'];
  const missing = requiredTokens.filter((token) => !content.includes(token));

  if (missing.length > 0) {
    logger.error(`Fallback SLO validation failed. Missing tokens: ${missing.join(', ')}`);
    return 1;
  }

  logger.warn(
    `promtool not found locally (tried '${promtool}'). Ran fallback structural validation for slo-rules.test.yml.`
  );
  return 0;
}

const check = spawnSync(promtool, ['--version'], { stdio: 'ignore', shell: true });
if (check.status !== 0) {
  if (String(process.env.CI ?? 'false').toLowerCase() !== 'true') {
    process.exit(runLocalFallbackRulesCheck());
  }
  logger.error(
    `promtool is required for SLO rule tests but was not found. Tried '${promtool}'.\n` +
      'Set PROMTOOL_BIN or install promtool in PATH.\n' +
      'CI should provision promtool deterministically in .tools/promtool.'
  );
  process.exit(1);
}

const run = spawnSync(promtool, ['test', 'rules', testsFile], {
  stdio: 'inherit',
  shell: true
});

process.exit(run.status ?? 1);
