#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');

const ROOT = process.cwd();

const SCAN_DIRS = [
  path.join(ROOT, 'src'),
  path.join(ROOT, 'queues'),
  path.join(ROOT, 'scripts')
];

const ALLOWED_EXTENSIONS = new Set(['.ts', '.js', '.mjs']);

const FORBIDDEN_PATTERNS = [
  {
    name: 'Prisma raw-unsafe API',
    regex: /\$(?:queryRawUnsafe|executeRawUnsafe)\s*\(/g,
    message: 'Use parameterized Prisma tagged-template APIs instead of unsafe raw APIs.'
  },
  {
    name: 'Prisma.raw usage',
    regex: /Prisma\.raw\s*\(/g,
    message: 'Avoid Prisma.raw because it can bypass parameterization guarantees.'
  }
];

function shouldSkipFile(absolutePath) {
  const normalized = absolutePath.replace(/\\/g, '/');
  if (normalized.includes('/node_modules/')) return true;
  if (normalized.includes('/dist/')) return true;
  if (normalized.includes('/artifacts/')) return true;
  if (normalized.includes('/prisma/migrations/')) return true;
  if (normalized.endsWith('/scripts/sql-injection-guard.js')) return true;
  if (normalized.endsWith('/scripts/sql-injection-guard.test.js')) return true;
  return false;
}

function walkFiles(directory, out) {
  if (!fs.existsSync(directory)) {
    return;
  }
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolute, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!ALLOWED_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    if (shouldSkipFile(absolute)) {
      continue;
    }
    out.push(absolute);
  }
}

function findLineAndColumn(source, index) {
  const pre = source.slice(0, index);
  const line = pre.split('\n').length;
  const column = index - pre.lastIndexOf('\n');
  return { line, column };
}

function inspectSource(filePath, source) {
  const issues = [];
  for (const pattern of FORBIDDEN_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match = pattern.regex.exec(source);
    while (match) {
      const { line, column } = findLineAndColumn(source, match.index);
      issues.push({
        file: path.relative(ROOT, filePath),
        line,
        column,
        rule: pattern.name,
        message: pattern.message,
        snippet: match[0]
      });
      match = pattern.regex.exec(source);
    }
  }
  return issues;
}

function runSqlInjectionGuard() {
  const files = [];
  for (const directory of SCAN_DIRS) {
    walkFiles(directory, files);
  }

  const issues = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    issues.push(...inspectSource(file, source));
  }

  return issues;
}

if (require.main === module) {
  const issues = runSqlInjectionGuard();
  if (issues.length > 0) {
    logger.error('SQL injection guard failed');
    for (const issue of issues) {
      logger.error(
        `  - ${issue.file}:${issue.line}:${issue.column} [${issue.rule}] ${issue.message} (matched: ${issue.snippet})`
      );
    }
    process.exit(1);
  }
  logger.success('SQL injection guard passed');
}

module.exports = {
  runSqlInjectionGuard,
  inspectSource,
  FORBIDDEN_PATTERNS
};
