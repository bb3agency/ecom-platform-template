#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');
const { ENV_RUNTIME_CONTRACT, validateEnvRuntimeContract } = require('./env-runtime-contract.js');

const root = path.resolve(__dirname, '..');
const envExamplePath = path.join(root, '.env.example');
const composePath = path.join(root, 'docker-compose.yml');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function parseEnvExampleKeys(source) {
  const liveEntries = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => {
      const [key, ...rest] = line.split('=');
      return { key, value: rest.join('='), stub: false };
    });
  // Also capture commented stubs: lines like "# KEY=" or "# KEY=value"
  // These document ops-overlay-managed keys without activating them.
  const stubEntries = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#\s*[A-Z0-9_]+=/.test(line))
    .map((line) => {
      const stripped = line.replace(/^#\s*/, '');
      const [key, ...rest] = stripped.split('=');
      return { key, value: rest.join('='), stub: true };
    });
  // Live entries take precedence over stubs
  const allByKey = new Map();
  for (const entry of [...stubEntries, ...liveEntries]) {
    allByKey.set(entry.key, entry);
  }
  return {
    keys: new Set(allByKey.keys()),
    valuesByKey: new Map([...allByKey.entries()].map(([k, e]) => [k, e.value])),
    stubKeys: new Set([...allByKey.values()].filter((e) => e.stub).map((e) => e.key))
  };
}

function extractServiceSection(composeSource, serviceName) {
  const lines = composeSource.split(/\r?\n/);
  const startMarker = `  ${serviceName}:`;
  const startIndex = lines.findIndex((line) => line.trimEnd() === startMarker);
  if (startIndex < 0) {
    return '';
  }
  const sectionLines = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(line)) {
      break;
    }
    if (/^[A-Za-z]+:\s*$/.test(line)) {
      break;
    }
    sectionLines.push(line);
  }
  return sectionLines.join('\n');
}

function collectConfigRuntimeParityErrors(envExample, compose) {
  const errors = [...validateEnvRuntimeContract(ENV_RUNTIME_CONTRACT)];

  const parsedEnv = parseEnvExampleKeys(envExample);
  for (const entry of ENV_RUNTIME_CONTRACT.envExampleRequired) {
    if (!parsedEnv.keys.has(entry.key)) {
      errors.push(`.env.example is missing required key: ${entry.key}`);
      continue;
    }
    // dbOverlay keys are allowed to appear as commented stubs only — no live value required.
    if (entry.dbOverlay) continue;
    if (!entry.allowEmptyInExample) {
      const envValue = parsedEnv.valuesByKey.get(entry.key) ?? '';
      if (envValue.trim().length === 0) {
        errors.push(`.env.example key must not be empty: ${entry.key}`);
      }
    }
  }

  for (const [serviceName, requiredKeys] of Object.entries(ENV_RUNTIME_CONTRACT.composeRequiredByService)) {
    const section = extractServiceSection(compose, serviceName);
    if (!section) {
      errors.push(`docker-compose.yml is missing service section: ${serviceName}`);
      continue;
    }
    // Services now use env_file: .env instead of individual env var pass-throughs.
    // Validate that the service declares env_file so all vars are injected.
    if (!section.includes('env_file')) {
      // Fallback: check for individual pass-throughs (legacy inline style)
      for (const key of requiredKeys) {
        const envRef = `- ${key}=\${${key}}`;
        if (!section.includes(envRef)) {
          errors.push(`docker-compose.yml service "${serviceName}" is missing env_file or env pass-through: ${envRef}`);
        }
      }
    }
  }
  return errors;
}

function runConfigRuntimeParityCheck() {
  const envExample = read(envExamplePath);
  const compose = read(composePath);
  const errors = collectConfigRuntimeParityErrors(envExample, compose);

  if (errors.length > 0) {
    logger.error('Config-runtime parity drift detected:');
    for (const error of errors) {
      logger.error(`- ${error}`);
    }
    process.exit(1);
  }

  logger.success('Config-runtime parity check passed');
}

if (require.main === module) {
  runConfigRuntimeParityCheck();
}

module.exports = {
  runConfigRuntimeParityCheck,
  collectConfigRuntimeParityErrors,
  parseEnvExampleKeys,
  extractServiceSection
};
