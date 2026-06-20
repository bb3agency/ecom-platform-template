const test = require('node:test');
const assert = require('node:assert/strict');

const { collectDocsRuntimeDriftErrors, runDocsRuntimeDriftCheck } = require('./docs-runtime-drift-check.js');

test('docs-runtime drift check passes for current repository state', () => {
  assert.doesNotThrow(() => runDocsRuntimeDriftCheck());
});

test('collectDocsRuntimeDriftErrors reports missing critical claims', () => {
  const errors = collectDocsRuntimeDriftErrors({
    trd: 'no required claims',
    dockerfile: 'FROM node:22',
    coverage: { domains: [{ name: 'auth', minLinesPct: 10 }] },
    edgePolicy: 'auth: { appLimitPerMinute: 12 }',
    sloRules: '',
    goLiveGuide: '',
    vpsGuide: '',
    frontendGuide: '',
    mainSource: '',
    appSource: ''
  });
  assert.equal(errors.some((entry) => entry.includes('runtime Docker start command')), true);
  assert.equal(errors.some((entry) => entry.includes('TRD response contract statement')), true);
  assert.equal(errors.some((entry) => entry.includes('runtime plugin+hook registration order')), true);
});
