const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');
const logger = require('./lib/logger');

dotenv.config();

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PRISMA_SCHEMA_PATH = path.join('prisma', 'schema.prisma');

function commandForNpx() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe'
  });
}

function fatalWithCommandFailure(message, result) {
  logger.error(message, {
    status: result.status ?? 'unknown',
    errorCode: result.error?.code,
    errorMessage: result.error?.message,
    stderr: (result.stderr ?? '').trim(),
    stdout: (result.stdout ?? '').trim()
  });
  process.exit(1);
}

function resolveLocalPrismaCommand() {
  const prismaBinName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  const prismaBinPath = path.join(PROJECT_ROOT, 'node_modules', '.bin', prismaBinName);
  return fs.existsSync(prismaBinPath) ? prismaBinPath : null;
}

function resolveLocalPrismaNodeEntrypoint() {
  const prismaCliPath = path.join(PROJECT_ROOT, 'node_modules', 'prisma', 'build', 'index.js');
  return fs.existsSync(prismaCliPath) ? prismaCliPath : null;
}

function runPrismaCommand(args) {
  const prismaNodeEntrypoint = resolveLocalPrismaNodeEntrypoint();
  if (prismaNodeEntrypoint) {
    return runCommand(process.execPath, [prismaNodeEntrypoint, ...args], { cwd: PROJECT_ROOT });
  }

  const localPrismaCommand = resolveLocalPrismaCommand();

  if (localPrismaCommand) {
    return runCommand(localPrismaCommand, args, { cwd: PROJECT_ROOT });
  }

  const npxCommand = commandForNpx();
  return runCommand(npxCommand, ['prisma', ...args], { cwd: PROJECT_ROOT });
}

function parseDatabaseName() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    logger.fatal('DATABASE_URL is required before starting API/workers.');
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    logger.fatal('DATABASE_URL is not a valid URL.');
  }

  if (!parsed.protocol.startsWith('postgres')) {
    logger.fatal('DATABASE_URL must use a postgres/postgresql protocol.');
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '').trim());
  if (!databaseName) {
    logger.fatal('DATABASE_URL must include a database name in the path segment.');
  }

  return databaseName;
}

function warnLikelyTemplateDatabaseReuse(databaseName) {
  const normalizedDb = databaseName.trim().toLowerCase();
  const cwd = process.cwd().toLowerCase();
  const looksLikeClientWorkspace = cwd.includes('\\clients\\') || cwd.includes('/clients/');

  if (looksLikeClientWorkspace && normalizedDb === 'ecom_template') {
    logger.warn('DATABASE_URL appears to use template database name in a client workspace.', {
      databaseName,
      hint: 'Set DATABASE_URL to a client-specific DB name (for example: raghava_organics) before first boot.'
    });
  }
}

function resolvePostgresContainerName() {
  if (process.env.POSTGRES_CONTAINER_NAME?.trim()) {
    return process.env.POSTGRES_CONTAINER_NAME.trim();
  }
  const clientId = (process.env.CLIENT_ID ?? 'ecom').trim() || 'ecom';
  return `${clientId}-postgres`;
}

function ensureDatabaseExists(databaseName) {
  const containerName = resolvePostgresContainerName();
  const postgresUser = (process.env.POSTGRES_USER ?? 'postgres').trim() || 'postgres';
  const escapedNameForQuery = databaseName.replace(/'/g, "''");

  const checkResult = runCommand('docker', [
    'exec',
    containerName,
    'psql',
    '-U',
    postgresUser,
    '-d',
    'postgres',
    '-tAc',
    `SELECT 1 FROM pg_database WHERE datname='${escapedNameForQuery}'`
  ]);

  if (checkResult.status !== 0) {
    fatalWithCommandFailure('Unable to check target database existence in postgres container.', checkResult);
  }

  if ((checkResult.stdout ?? '').trim() === '1') {
    logger.info('Prisma target database already exists.', { databaseName });
    return;
  }

  logger.warn('Prisma target database missing. Creating database before migrations.', { databaseName });
  const escapedNameForCreate = databaseName.replace(/"/g, '""');
  const createResult = runCommand('docker', [
    'exec',
    containerName,
    'psql',
    '-U',
    postgresUser,
    '-d',
    'postgres',
    '-c',
    `CREATE DATABASE "${escapedNameForCreate}";`
  ]);

  if (createResult.status !== 0) {
    fatalWithCommandFailure('Failed to create Prisma target database.', createResult);
  }

  logger.success('Created Prisma target database.', { databaseName });
}

function runPrismaGenerateSafe() {
  const safeScript = path.join(__dirname, 'prisma-generate-safe.js');
  const args = [safeScript];
  if (process.platform === 'win32') {
    args.push('--kill-lockers');
  }

  logger.info('Running Prisma client generation (safe retries)...');
  const generateResult = runCommand(process.execPath, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit'
  });

  if (generateResult.status !== 0) {
    fatalWithCommandFailure('Prisma generate failed.', generateResult);
  }
}

function runPrismaBootstrap(skipGenerate = false) {
  if (!skipGenerate) {
    runPrismaGenerateSafe();
  } else {
    logger.info('Skipping Prisma client generation (--skip-generate flag set).');
  }

  logger.info('Applying Prisma migrations (deploy mode)...');
  const migrateResult = runPrismaCommand(['migrate', 'deploy', '--schema', PRISMA_SCHEMA_PATH]);
  if (migrateResult.status !== 0) {
    fatalWithCommandFailure('Prisma migrate deploy failed.', migrateResult);
  }
  if ((migrateResult.stdout ?? '').trim()) {
    process.stdout.write(migrateResult.stdout);
  }
  if ((migrateResult.stderr ?? '').trim()) {
    process.stderr.write(migrateResult.stderr);
  }

  logger.success('Prisma bootstrap complete(database ready + migrations applied).');
}

function main() {
  const skipGenerate = process.argv.includes('--skip-generate');
  const databaseName = parseDatabaseName();
  warnLikelyTemplateDatabaseReuse(databaseName);
  ensureDatabaseExists(databaseName);
  runPrismaBootstrap(skipGenerate);
}

main();
