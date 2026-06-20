#!/usr/bin/env node

const logger = require('./lib/logger');

function evaluateBurnRate(errorRatio) {
  const fastBurnPage = errorRatio > 14.4 * 0.001;
  const slowBurnPage = errorRatio > 6 * 0.001;
  const ticket = errorRatio > 1 * 0.001;
  return {
    fastBurnPage,
    slowBurnPage,
    ticket,
    route: fastBurnPage || slowBurnPage ? 'page' : ticket ? 'ticket' : 'none'
  };
}

const scenarios = [
  { name: 'healthy', success: 9990, total: 10000 },
  { name: 'slow-burn', success: 9950, total: 10000 },
  { name: 'fast-burn', success: 9800, total: 10000 }
];

for (const scenario of scenarios) {
  const errors = Math.max(0, scenario.total - scenario.success);
  const ratio = scenario.total > 0 ? errors / scenario.total : 0;
  const result = evaluateBurnRate(ratio);
  const summary = [
    `scenario=${scenario.name}`,
    `errorRatio=${ratio.toFixed(4)}`,
    `fastBurnPage=${result.fastBurnPage}`,
    `slowBurnPage=${result.slowBurnPage}`,
    `ticket=${result.ticket}`,
    `route=${result.route}`
  ].join(' ');
  logger.info(summary);
}
