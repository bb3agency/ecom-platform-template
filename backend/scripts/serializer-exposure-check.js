#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');

const ROOT = process.cwd();

const RULES = [
  {
    file: path.join('src', 'modules', 'orders', 'orders.service.ts'),
    required: ['serializeOrder(', 'fingerprintIdentifier(', 'exposeProviderReferences'],
    forbidden: ['return order;', 'return updatedOrder;']
  },
  {
    file: path.join('src', 'modules', 'reviews', 'reviews.service.ts'),
    required: ['serializeReview('],
    forbidden: ['return review;', 'return reviews;']
  },
  {
    file: path.join('src', 'modules', 'analytics', 'analytics.service.ts'),
    required: ['redactReplayMetadata(', 'redactSensitiveData('],
    forbidden: ['return payload;', 'return metadata;']
  },
  {
    file: path.join('src', 'modules', 'users', 'users.service.ts'),
    required: ['return {'],
    forbidden: ['return user;', 'passwordHash:']
  }
];

function inspectFile(filePath, source, required, forbidden) {
  const issues = [];
  for (const token of required) {
    if (!source.includes(token)) {
      issues.push(`${filePath}: missing expected token "${token}"`);
    }
  }
  for (const token of forbidden) {
    if (source.includes(token)) {
      issues.push(`${filePath}: found forbidden token "${token}"`);
    }
  }
  return issues;
}

function runSerializerExposureCheck(customRules = RULES) {
  const issues = [];
  for (const rule of customRules) {
    const absolute = path.join(ROOT, rule.file);
    if (!fs.existsSync(absolute)) {
      issues.push(`${rule.file}: file not found`);
      continue;
    }
    const source = fs.readFileSync(absolute, 'utf8');
    issues.push(...inspectFile(rule.file, source, rule.required, rule.forbidden));
  }
  return issues;
}

if (require.main === module) {
  const issues = runSerializerExposureCheck();
  if (issues.length > 0) {
    logger.error('Serializer exposure check failed');
    for (const issue of issues) {
      logger.error(`  - ${issue}`);
    }
    process.exit(1);
  }
  logger.success('Serializer exposure check passed');
}

module.exports = {
  inspectFile,
  runSerializerExposureCheck,
  RULES
};
