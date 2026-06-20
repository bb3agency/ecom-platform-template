# Raghava Organics — Local Backend Setup Evidence

> **Date:** 2026-05-23  
> **CLIENT_ID:** `raghava-organics`  
> **POSTGRES_DB:** `raghava_organics`

## Bootstrap env verification

```text
$ cd backend && node scripts/verify-client-bootstrap-env.mjs
Bootstrap env verification OK for CLIENT_ID=raghava-organics POSTGRES_DB=raghava_organics
Warnings:
  - RESEND_API_KEY is placeholder — required before ops:newuser on VPS
```

## Docker infrastructure

```text
$ docker compose up -d postgres redis
Container raghava-organics-postgres Started
Container raghava-organics-redis Started
```

## Prisma migrations

8 migrations applied to `raghava_organics`; schema up to date.

## Runtime health (API + workers)

**Windows start (when `dev-up.cmd` kills node):**

```powershell
cd backend
$env:PAYMENT_PROVIDER='noop'; $env:SHIPPING_PROVIDER='noop'; $env:NODE_ENV='development'
npx tsx watch src/main.ts
# separate terminal:
npx tsx watch queues/workers/index.ts
```

**`GET /api/v1/health`:** `database` + `redis` connected.

## Static gates (local)

| Check | Result |
|-------|--------|
| `npm run typecheck` | pass |
| `npm run test:unit` | 628/628 pass |
| `npm run build` | pass |
| `npm run verify:vps-preflight` | pass |
