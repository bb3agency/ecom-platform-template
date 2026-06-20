const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  parseEnvFileKeys,
  runProposal
} = require('./ops-config-contract-proposal.js');

test('parseEnvFileKeys returns only keys, never values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-proposal-'));
  const envFile = path.join(dir, '.env.test');

  fs.writeFileSync(envFile, [
    'RAZORPAY_KEY_SECRET=super-secret-value',
    'NOTIFY_EMAIL_ENABLED=true',
    '# comment should be ignored',
    'INVALID LINE',
    ''
  ].join('\n'));

  const keys = parseEnvFileKeys(envFile);

  assert.deepEqual(keys, ['RAZORPAY_KEY_SECRET', 'NOTIFY_EMAIL_ENABLED']);
  assert.equal(keys.includes('super-secret-value'), false);
});

test('runProposal emits explicit read-only safety banner', () => {
  const result = runProposal({ envFiles: ['.missing.env.file'] });
  assert.equal(result.lines[0].startsWith('READ-ONLY:'), true);
});

test('runProposal does not modify ops contract file mtime', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const contractPath = path.join(repoRoot, 'src', 'modules', 'ops', 'ops-config-contract.ts');

  const before = fs.statSync(contractPath).mtimeMs;
  runProposal({ envFiles: ['.missing.env.file'] });
  const after = fs.statSync(contractPath).mtimeMs;

  assert.equal(after, before);
});

test('cli rejects apply/write style flags', () => {
  const cliPath = path.resolve(__dirname, 'ops-config-contract-proposal.js');
  const result = spawnSync(process.execPath, [cliPath, '--apply'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /read-only/i);
});
