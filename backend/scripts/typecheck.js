#!/usr/bin/env node
// Wrapper to invoke tsc with --noEmit safely on Node 24+ (Windows).
// Node 24 on Windows has native TS stripping that intercepts tsc .cmd shims;
// this wrapper calls tsc's JS entry point directly via child_process.
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const tscBin = path.join(__dirname, '..', 'node_modules', 'typescript', 'bin', 'tsc');
const result = spawnSync(process.execPath, [tscBin, '--noEmit', '--project', 'tsconfig.json'], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, NODE_OPTIONS: '' }
});

process.exit(result.status ?? 1);
