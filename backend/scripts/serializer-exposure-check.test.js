const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectFile, runSerializerExposureCheck } = require('./serializer-exposure-check.js');

test('inspectFile reports missing required token', () => {
  const issues = inspectFile('x.ts', 'function ok() {}', ['serializeOrder('], []);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].includes('missing expected token'), true);
});

test('inspectFile reports forbidden token', () => {
  const issues = inspectFile('x.ts', 'return user;', [], ['return user;']);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].includes('forbidden token'), true);
});

test('runSerializerExposureCheck supports custom in-memory rules', () => {
  const issues = runSerializerExposureCheck([
    {
      file: 'scripts/serializer-exposure-check.js',
      required: ['runSerializerExposureCheck('],
      forbidden: ['definitely-not-present-token']
    }
  ]);
  assert.deepEqual(issues, []);
});
