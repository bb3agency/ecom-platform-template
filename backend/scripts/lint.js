#!/usr/bin/env node
// Wrapper to invoke ESLint safely on Node 24+ (Windows).
// Uses the ESLint Node.js API directly to avoid .cmd shim and shell quoting issues.
'use strict';
const path = require('path');

async function main() {
  const { ESLint } = require(path.join(__dirname, '..', 'node_modules', 'eslint'));
  const eslint = new ESLint();
  const results = await eslint.lintFiles(['src/**/*.ts', 'queues/**/*.ts']);
  const formatter = await eslint.loadFormatter('stylish');
  const output = await formatter.format(results);
  if (output) process.stdout.write(output + '\n');
  const errorCount = results.reduce((sum, r) => sum + r.errorCount, 0);
  const warnCount = results.reduce((sum, r) => sum + r.warningCount, 0);
  if (errorCount > 0) {
    process.stderr.write(`ESLint found ${errorCount} error(s) and ${warnCount} warning(s).\n`);
    process.exit(1);
  }
  if (warnCount > 0) {
    process.stderr.write(`ESLint found ${warnCount} warning(s).\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`ESLint fatal error: ${err.message}\n`);
  process.exit(2);
});
