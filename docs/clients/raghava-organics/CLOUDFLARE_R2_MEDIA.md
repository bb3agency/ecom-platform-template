# Raghava Organics — Cloudflare DNS + R2 product media

**Last updated:** 2026-06-11

## DNS

| Item | Value |
|------|-------|
| Registrar | Namecheap |
| Authoritative DNS | **Cloudflare** (nameservers updated at Namecheap) |
| Production domain | `raghavaorganics.com` |
| Image CDN hostname | `cdn.raghavaorganics.com` |
| VPS origin | `178.104.46.202` |

Storefront and API terminate at Nginx on the VPS (`raghavaorganics.com` → `127.0.0.1:3101` / `3001`). Product images are served from **Cloudflare R2** via the custom domain `cdn.raghavaorganics.com` (not from the VPS disk in production).

## R2 bucket (non-secret identifiers)

| Ops / env key | Value |
|---------------|-------|
| `MEDIA_STORAGE_PROVIDER` | `r2` |
| `R2_ACCOUNT_ID` | `2e87c8fb8842d3a372a5abc98b5cd6cf` |
| `R2_BUCKET_NAME` | `raghava-organics-product-images` |
| `R2_ENDPOINT` | `https://2e87c8fb8842d3a372a5abc98b5cd6cf.r2.cloudflarestorage.com` |
| `R2_PUBLIC_BASE_URL` | `https://cdn.raghavaorganics.com` |
| `PUBLIC_STORE_URL` | `https://raghavaorganics.com` |

**API credentials** (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) live in the private vault only — [VPS_INPUTS.md](./VPS_INPUTS.md) (gitignored). Enter via **Ops UI → Product Media (Cloudflare R2)** after Phase 8; restart API + workers after save.

## Frontend pairing (production)

In `frontend/.env.production.local` on the VPS:

```env
NEXT_PUBLIC_IMAGE_CDN_URL=https://cdn.raghavaorganics.com
```

Must match Ops `R2_PUBLIC_BASE_URL` exactly (scheme + host, no trailing slash). Backend stores absolute URLs like `https://cdn.raghavaorganics.com/raghava-organics/products/...` on each upload.

## Ops UI save checklist

1. Log in to `/ops` → **Config** → **Product Media (Cloudflare R2)**.
2. Set all keys in the table above plus access key + secret from vault.
3. Save (OTP if prompted) → **restart** API and workers.
4. Verify: `GET /api/v1/health/ready` — no missing media keys.
5. Preflight (from backend dir, no R2 in `.env`): `npm run verify:r2-media`.
6. Admin smoke: upload one product image ≤ 5 MiB → PDP loads from `cdn.raghavaorganics.com`.

## Local development

Keep `MEDIA_STORAGE_PROVIDER=local` in Ops (or unset). Optional `NEXT_PUBLIC_IMAGE_CDN_URL=http://localhost:3101` for relative `/api/v1/media/...` paths via Next rewrite.

## Security note

Never commit `R2_SECRET_ACCESS_KEY` or paste it in PRs/chat. If exposed, revoke the token in Cloudflare → R2 → Manage R2 API Tokens and create a new pair, then update Ops config + vault.
