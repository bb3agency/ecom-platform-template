const fs = require('fs');
const path = require('path');
const tsConfigPaths = require('tsconfig-paths');
const logger = require('./scripts/lib/logger');

// Load .env so NODE_ENV and all bootstrap vars are available when the server
// is started directly (node bootstrap-backend.js / npm start) without a shell
// that pre-exports them. Already-set env vars are never overridden.
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

const config = tsConfigPaths.loadConfig('tsconfig.production.json');
if (config.resultType === 'success') {
  tsConfigPaths.register({ baseUrl: config.absoluteBaseUrl, paths: config.paths });
} else {
  logger.error('Failed to load tsconfig.production.json', { config });
  process.exit(1);
}
require('./dist/src/main.js');
