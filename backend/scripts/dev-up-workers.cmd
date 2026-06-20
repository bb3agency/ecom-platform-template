@echo off
REM ============================================================================
REM Dev startup orchestrator — BullMQ workers (Windows CMD)
REM
REM Idempotent. Handles:
REM   1. Ensures Docker infrastructure (postgres + redis) is running
REM   2. Ensures Prisma target DB exists, generates client, applies migrations
REM   3. Sets noop provider env vars
REM   4. Starts workers with tsx watch
REM
REM Usage: scripts\dev-up-workers.cmd
REM ============================================================================

setlocal enabledelayedexpansion

set "PROJECT_ROOT=%~dp0.."
pushd "%PROJECT_ROOT%"

REM Load CLIENT_ID and REDIS_PASSWORD from .env
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if /I "%%A"=="CLIENT_ID" set "CLIENT_ID=%%B"
  if /I "%%A"=="REDIS_PASSWORD" set "REDIS_PASSWORD=%%B"
)
if not defined CLIENT_ID set "CLIENT_ID=ecom"
set "POSTGRES_CONTAINER=%CLIENT_ID%-postgres"
set "REDIS_CONTAINER=%CLIENT_ID%-redis"
echo   Using container names: %POSTGRES_CONTAINER% / %REDIS_CONTAINER%

echo [1/4] Ensuring Docker infrastructure is running...
docker start %POSTGRES_CONTAINER% >nul 2>&1
docker start %REDIS_CONTAINER% >nul 2>&1

docker ps --filter name=%REDIS_CONTAINER% --format "{{.Names}}" | findstr /B /L /C:"%REDIS_CONTAINER%" >nul
if errorlevel 1 (
  echo   Containers not found — running docker compose up -d postgres redis
  docker compose up -d postgres redis
  if errorlevel 1 (
    echo ERROR: Failed to start infrastructure. Is Docker Desktop running?
    exit /b 1
  )
)

echo [2/4] Waiting for Redis to be ready...
set /a _redis_tries=0
:wait_redis
if defined REDIS_PASSWORD (
  docker exec %REDIS_CONTAINER% redis-cli -a "%REDIS_PASSWORD%" ping 2>nul | findstr /B /L /C:"PONG" >nul
) else (
  docker exec %REDIS_CONTAINER% redis-cli ping 2>nul | findstr /B /L /C:"PONG" >nul
)
if errorlevel 1 (
  set /a _redis_tries+=1
  if !_redis_tries! geq 15 (
    echo ERROR: Redis did not become ready within 15 seconds.
    exit /b 1
  )
  timeout /t 1 /nobreak >nul
  goto wait_redis
)
echo   Redis OK.

echo [3/4] Ensuring Prisma database + migrations are ready...
node scripts\dev-ensure-prisma-ready.js --skip-generate
if errorlevel 1 (
  echo ERROR: Prisma bootstrap failed. Fix the error above and retry.
  exit /b 1
)

echo [4/4] Starting workers (tsx watch)...
set PAYMENT_PROVIDER=noop
set RAZORPAY_WEBHOOK_SECRET=test_webhook_secret
set SHIPROCKET_WEBHOOK_TOKEN=test_webhook_token
set NODE_ENV=development
npx tsx watch queues/workers/index.ts

popd

endlocal
