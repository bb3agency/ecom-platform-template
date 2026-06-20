#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');

const root = path.resolve(__dirname, '..');
const edgePolicyPath = path.join(root, 'src', 'common', 'security', 'edge-policy.ts');
const nginxServerPath = path.join(root, 'nginx', 'client.conf.template');
const nginxZonesPath = path.join(root, 'nginx', 'rate-zones.conf.template');

function parseEdgeRules(source) {
  const rules = {};
  const ruleRegex = /(\w+)\s*:\s*\{([\s\S]*?)\}/g;
  let match = ruleRegex.exec(source);
  while (match) {
    const name = match[1];
    const body = match[2];
    const className = body.match(/className\s*:\s*'([^']+)'/);
    const appLimit = body.match(/appLimitPerMinute\s*:\s*(\d+)/);
    const edgeRate = body.match(/edgeRatePerMinute\s*:\s*(\d+)/);
    const edgeBurst = body.match(/edgeBurst\s*:\s*(\d+)/);

    if (className && appLimit && edgeRate && edgeBurst) {
      rules[name] = {
        appLimitPerMinute: Number(appLimit[1]),
        edgeRatePerMinute: Number(edgeRate[1]),
        edgeBurst: Number(edgeBurst[1])
      };
    }
    match = ruleRegex.exec(source);
  }
  return rules;
}

function parseNginxZones(source) {
  const zones = {};
  const conflicts = [];

  const zoneRegex = /^\s*limit_req_zone\s+\S+\s+zone=api_(\w+):\d+m\s+rate=(\d+)r\/m;/gm;
  let zoneMatch = zoneRegex.exec(source);
  while (zoneMatch) {
    const className = zoneMatch[1];
    const parsedRate = Number(zoneMatch[2]);
    if (className in zones && zones[className] !== parsedRate) {
      conflicts.push(
        `Conflicting nginx rate definitions for class '${className}': ${zones[className]} vs ${parsedRate}`
      );
    } else {
      zones[className] = parsedRate;
    }
    zoneMatch = zoneRegex.exec(source);
  }

  return { zones, conflicts };
}

function parseNginxBursts(source) {
  const bursts = {};
  const conflicts = [];

  const burstRegex = /^\s*limit_req\s+zone=api_(\w+)\s+burst=(\d+)\s+nodelay;/gm;
  let burstMatch = burstRegex.exec(source);
  while (burstMatch) {
    const className = burstMatch[1];
    const parsedBurst = Number(burstMatch[2]);
    if (className in bursts && bursts[className] !== parsedBurst) {
      conflicts.push(
        `Conflicting nginx burst definitions for class '${className}': ${bursts[className]} vs ${parsedBurst}`
      );
    } else {
      bursts[className] = parsedBurst;
    }
    burstMatch = burstRegex.exec(source);
  }

  return { bursts, conflicts };
}

const edgeSource = fs.readFileSync(edgePolicyPath, 'utf8');
const nginxServerSource = fs.readFileSync(nginxServerPath, 'utf8');
const nginxZonesSource = fs.readFileSync(nginxZonesPath, 'utf8');
const edgeRules = parseEdgeRules(edgeSource);
const zoneParse = parseNginxZones(nginxZonesSource);
const burstParse = parseNginxBursts(nginxServerSource);
const nginx = {
  zones: zoneParse.zones,
  bursts: burstParse.bursts,
  conflicts: [...zoneParse.conflicts, ...burstParse.conflicts]
};

const errors = [...nginx.conflicts];
for (const [className, rule] of Object.entries(edgeRules)) {
  if (!(className in nginx.zones)) {
    errors.push(`Missing nginx rate zone for class '${className}'`);
    continue;
  }
  if (nginx.zones[className] !== rule.edgeRatePerMinute) {
    errors.push(
      `Rate mismatch for '${className}': edge-policy=${rule.edgeRatePerMinute} nginx=${nginx.zones[className]}`
    );
  }
  if ((nginx.bursts[className] ?? null) !== rule.edgeBurst) {
    errors.push(`Burst mismatch for '${className}': edge-policy=${rule.edgeBurst} nginx=${nginx.bursts[className] ?? 'missing'}`);
  }
}

if (errors.length > 0) {
  logger.error('Edge policy drift detected:');
  for (const error of errors) {
    logger.error(`- ${error}`);
  }
  process.exit(1);
}

logger.success('Edge policy drift check passed');
