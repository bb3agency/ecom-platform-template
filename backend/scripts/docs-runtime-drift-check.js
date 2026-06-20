#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const logger = require('./lib/logger');

const root = path.resolve(__dirname, '..');
const trdPath = path.join(root, 'TRD.md');
const dockerfilePath = path.join(root, 'Dockerfile');
const coverageRatchetPath = path.join(root, 'observability', 'coverage-ratchet.json');
const edgePolicyPath = path.join(root, 'src', 'common', 'security', 'edge-policy.ts');
const sloRulesPath = path.join(root, 'observability', 'slo-rules.yml');
const goLiveGuidePath = path.join(root, 'docs', 'CLIENT_GO_LIVE_VALIDATION_GUIDE.md');
const vpsGuidePath = path.join(root, 'docs', 'CLIENT_VPS_SETUP_GUIDE.md');
const frontendGuidePath = path.join(root, 'docs', 'NEXTJS_FRONTEND_INTEGRATION_GUIDE.md');
const mainPath = path.join(root, 'src', 'main.ts');
const appPath = path.join(root, 'src', 'app.ts');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function assertIncludes(source, expected, label, errors) {
  if (!source.includes(expected)) {
    errors.push(`Missing ${label}: "${expected}"`);
  }
}

function assertRegex(source, pattern, label, errors) {
  if (!pattern.test(source)) {
    errors.push(`Missing ${label}: ${pattern}`);
  }
}

function collectDocsRuntimeDriftErrors(sources) {
  const trd = sources.trd;
  const dockerfile = sources.dockerfile;
  const coverage = sources.coverage;
  const edgePolicy = sources.edgePolicy;
  const sloRules = sources.sloRules;
  const goLiveGuide = sources.goLiveGuide;
  const vpsGuide = sources.vpsGuide;
  const frontendGuide = sources.frontendGuide;
  const mainSource = sources.mainSource;
  const appSource = sources.appSource;
  const errors = [];

  assertIncludes(dockerfile, 'CMD ["node", "bootstrap-backend.js"]', 'runtime Docker start command', errors);
  assertIncludes(trd, 'CMD ["node", "bootstrap-backend.js"]', 'TRD Docker command', errors);

  const authFloor = Number(
    (coverage.domains.find((domain) => domain.name === 'auth') || { minLinesPct: NaN }).minLinesPct
  ).toFixed(1);
  assertIncludes(trd, `| Auth domain lines (ratchet floor) | ${authFloor}% |`, 'TRD auth coverage floor', errors);

  assertRegex(edgePolicy, /auth:\s*\{[\s\S]*?appLimitPerMinute:\s*12/, 'edge policy auth app limit', errors);
  assertRegex(edgePolicy, /checkout:\s*\{[\s\S]*?appLimitPerMinute:\s*30/, 'edge policy checkout app limit', errors);
  assertRegex(edgePolicy, /admin:\s*\{[\s\S]*?appLimitPerMinute:\s*60/, 'edge policy admin app limit', errors);
  assertRegex(edgePolicy, /catalog:\s*\{[\s\S]*?appLimitPerMinute:\s*300/, 'edge policy catalog app limit', errors);
  assertRegex(edgePolicy, /webhook:\s*\{[\s\S]*?appLimitPerMinute:\s*400/, 'edge policy webhook app limit', errors);
  assertRegex(edgePolicy, /cart:\s*\{[\s\S]*?appLimitPerMinute:\s*90/, 'edge policy cart app limit', errors);
  assertRegex(edgePolicy, /health:\s*\{[\s\S]*?appLimitPerMinute:\s*30/, 'edge policy health app limit', errors);
  assertRegex(edgePolicy, /default:\s*\{[\s\S]*?appLimitPerMinute:\s*120/, 'edge policy default app limit', errors);
  assertIncludes(trd, '| Auth sensitive (`/auth/send-otp`, `/auth/verify-otp`, `/auth/forgot-password`, `/auth/register`, `/auth/refresh`) | 6 per minute |', 'TRD auth-sensitive app limit', errors);
  assertIncludes(trd, '| Auth login (`/auth/login`, `/auth/admin/login/request-otp`, `/auth/admin/login/verify-otp`) | 12 per minute + progressive lockout on failed credentials |', 'TRD auth-login app limit', errors);
  assertIncludes(trd, '| Catalogue reads (`/products*`, `/reviews/product/*`, `/reviews/recent`) | 300 per minute (route profile) |', 'TRD catalog app limit', errors);
  assertIncludes(trd, '| Cart/user-session flows (`/cart*`, `/wishlist*`, `/users/me*`) | 90 per minute (route profile) |', 'TRD cart app limit', errors);
  assertIncludes(trd, '| Checkout/payment mutations (`/orders`, `/orders/:id/cancel`, `/payments/initiate`, `/payments/verify`) | 30 per minute (route profile) |', 'TRD checkout app limit', errors);
  assertIncludes(trd, '| Admin read routes (`/api/v1/admin/*` reads) | 60 per minute (route profile) |', 'TRD admin-read app limit', errors);
  assertIncludes(trd, '| Admin write routes (`/api/v1/admin/*` mutations) | 40 per minute (route profile) |', 'TRD admin-write app limit', errors);
  assertIncludes(trd, 'Error responses always use the standard envelope from the global error handler. Success responses return route-specific payloads directly by default.', 'TRD response contract statement', errors);

  assertIncludes(sloRules, 'expr: slo:webhook_latency:p95_5m > 0.5', 'SLO webhook latency threshold', errors);
  assertIncludes(trd, 'slo:webhook_latency:p95_5m', 'TRD webhook SLO metric reference', errors);
  assertIncludes(goLiveGuide, 'slo:webhook_latency:p95_5m > 0.5', 'Go-live guide webhook SLO reference', errors);
  assertIncludes(vpsGuide, 'slo:webhook_latency:p95_5m', 'VPS guide webhook SLO reference', errors);
  assertIncludes(frontendGuide, 'analytics → queues → ops', 'Frontend guide route order includes ops', errors);
  assertRegex(
    mainSource,
    /registerHelmetPlugin[\s\S]*registerCorsPlugin[\s\S]*registerJwtPlugin[\s\S]*registerRateLimitPlugin[\s\S]*registerMultipartPlugin[\s\S]*registerSwaggerPlugin[\s\S]*registerPrismaPlugin[\s\S]*registerRedisPlugin[\s\S]*registerBullmqPlugin[\s\S]*registerGlobalErrorHandler[\s\S]*registerObservabilityPlugin[\s\S]*addHook\('preHandler', loadShedGuard\)[\s\S]*registerApp/,
    'runtime plugin+hook registration order',
    errors
  );
  assertRegex(
    appSource,
    /registerHealthRoutes[\s\S]*registerAuthRoutes[\s\S]*registerCartRoutes[\s\S]*registerUsersRoutes[\s\S]*registerProductsRoutes[\s\S]*registerWishlistRoutes[\s\S]*registerReviewsRoutes[\s\S]*registerInventoryRoutes[\s\S]*registerSettingsRoutes[\s\S]*registerCouponsRoutes[\s\S]*registerOrdersRoutes[\s\S]*registerDashboardRoutes[\s\S]*registerAnalyticsRoutes[\s\S]*registerQueuesRoutes[\s\S]*registerOpsRoutes/,
    'runtime full module registration order',
    errors
  );

  return errors;
}

function runDocsRuntimeDriftCheck() {
  const errors = collectDocsRuntimeDriftErrors({
    trd: read(trdPath),
    dockerfile: read(dockerfilePath),
    coverage: JSON.parse(read(coverageRatchetPath)),
    edgePolicy: read(edgePolicyPath),
    sloRules: read(sloRulesPath),
    goLiveGuide: read(goLiveGuidePath),
    vpsGuide: read(vpsGuidePath),
    frontendGuide: read(frontendGuidePath),
    mainSource: read(mainPath),
    appSource: read(appPath)
  });
  if (errors.length > 0) {
    logger.error('Docs-runtime drift detected:');
    for (const error of errors) {
      logger.error(`- ${error}`);
    }
    process.exit(1);
  }

  logger.success('Docs-runtime drift check passed');
}

if (require.main === module) {
  runDocsRuntimeDriftCheck();
}

module.exports = { runDocsRuntimeDriftCheck, collectDocsRuntimeDriftErrors };
