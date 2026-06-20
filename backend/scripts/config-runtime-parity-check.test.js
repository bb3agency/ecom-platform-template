const test = require('node:test');
const assert = require('node:assert/strict');

const { collectConfigRuntimeParityErrors, runConfigRuntimeParityCheck } = require('./config-runtime-parity-check.js');
const { ENV_RUNTIME_CONTRACT, validateEnvRuntimeContract } = require('./env-runtime-contract.js');

test('config-runtime parity check passes for current repository state', () => {
  assert.doesNotThrow(() => runConfigRuntimeParityCheck());
});

test('collectConfigRuntimeParityErrors reports missing env and compose parity keys', () => {
  const errors = collectConfigRuntimeParityErrors(
    'DATABASE_URL=x\nREDIS_URL=x\n',
    'services:\n  backend:\n    environment:\n      - DATABASE_URL=${DATABASE_URL}\n  workers:\n    environment:\n      - DATABASE_URL=${DATABASE_URL}\n'
  );
  assert.equal(errors.some((entry) => entry.includes('.env.example is missing required key')), true);
  assert.equal(errors.some((entry) => entry.includes('docker-compose.yml service "backend" is missing env_file or env pass-through')), true);
  assert.equal(errors.some((entry) => entry.includes('docker-compose.yml service "workers" is missing env_file or env pass-through')), true);
});

test('ENV_RUNTIME_CONTRACT is internally consistent', () => {
  const errors = validateEnvRuntimeContract(ENV_RUNTIME_CONTRACT);
  assert.deepEqual(errors, []);
});
