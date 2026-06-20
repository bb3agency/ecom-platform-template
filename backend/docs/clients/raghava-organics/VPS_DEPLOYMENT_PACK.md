# Raghava Organics — VPS Deployment Pack

Use this pack when executing [CLIENT_ONBOARDING_EXECUTION_ORDER.md](../../../backend/docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md) Phases 6–8. **Do not commit production secrets to git.**

Fill [VPS_INPUTS.md](./VPS_INPUTS.md) first, then run scripts under [scripts/](./scripts/).

## Client identity

| Field | Value |
|-------|-------|
| Client name | Raghava Organics |
| `CLIENT_ID` | `raghava-organics` |
| `BACKEND_PORT` | `3001` (confirm free on VPS) |
| `STOREFRONT_PORT` | `3101` |
| `POSTGRES_DB` (host) | `raghava_organics` |
| VPS backend path | `/var/www/raghava-organics/backend` |
| VPS frontend path | `/var/www/raghava-organics/frontend` |
| Local API (dev) | `http://localhost:3000/api/v1` |
| Production API | `https://raghavaorganics.com/api/v1` |
| Production domain | `raghavaorganics.com` |
| VPS IP | `178.104.46.202` |

## Docker Compose on VPS

Production uses **host PostgreSQL** (port 5432) plus **Compose Redis + backend + workers** only:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml -p raghava-organics up -d backend workers
```

Do **not** run plain `docker compose up -d` on VPS — it starts a second Postgres container and fails with `address already in use` on `:5432`.

## Phase 1 production `.env` (bootstrap-only)

Copy to VPS `/var/www/raghava-organics/backend/.env` from vault. Template: [production.backend.env.example](./production.backend.env.example)

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Do not** put Razorpay, Delhivery/Shiprocket, MSG91, webhook tokens, or `OPS_METRICS_TOKEN` in `.env` — configure via Ops UI after Phase 8. See [ENV_VS_DB_CONFIG_REFERENCE.md](../../../backend/docs/ENV_VS_DB_CONFIG_REFERENCE.md).

## GitHub Actions (CD)

- **Full guide:** [backend/docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md](../../../backend/docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md)
- **Raghava values:** [GITHUB_CD_SETUP.md](./GITHUB_CD_SETUP.md)

## Nginx + TLS (multi-client VPS)

This VPS hosts **multiple clients**. Raghava is **slot 1**: ports **3001** / **3101**, domain **`raghavaorganics.com`**. Canonical rules: [CLIENT_VPS_SETUP_GUIDE.md](../../../backend/docs/CLIENT_VPS_SETUP_GUIDE.md) §11.0.

**Preflight (run before editing Nginx):**

```bash
cd /var/www/raghava-organics
bash docs/clients/raghava-organics/scripts/phase7.5-nginx-tls-preflight.sh
```

| Check | Raghava action |
| --- | --- |
| Other sites | `ls /etc/nginx/sites-enabled/` — **do not remove** other clients' symlinks |
| `default` site | **Do not** `rm sites-enabled/default` unless you verified it is unused |
| Rate zones | Once per VPS: `rate-zones.conf.template` → `/etc/nginx/snippets/rate-zones.conf` + `include` in `nginx.conf` `http {}` |
| Redis host port | Comment out `redis:` **`ports:`** in `backend/docker-compose.yml`; only one client can bind `0.0.0.0:6379` |
| Port conflict | `ss -tlnp \| grep -E '3001\|3101'` — must be free or owned by `raghava-organics-*` / PM2 |

**Install (additive — this domain only):**

1. `client.conf.template` → `/etc/nginx/sites-available/raghavaorganics.com` (domain-based filename)
2. `sudo sed -i 's/client1\.com/raghavaorganics.com/g' /etc/nginx/sites-available/raghavaorganics.com`
3. `proxy_pass` → `127.0.0.1:3001` (API), `/` → `127.0.0.1:3101` (storefront — after Phase 10)
4. `sudo ln -sf /etc/nginx/sites-available/raghavaorganics.com /etc/nginx/sites-enabled/`
5. `sudo nginx -t && sudo systemctl reload nginx`
6. `sudo certbot --nginx -d raghavaorganics.com -d www.raghavaorganics.com`
7. After certs: redeploy full HTTPS template from repo (same paths), reload nginx

Templates: [backend/nginx/](../../../backend/nginx/)

## Webhook URLs (after TLS)

- `https://<PRODUCTION_DOMAIN>/api/v1/payments/webhook`
- `https://<PRODUCTION_DOMAIN>/api/v1/shipping/webhook`

## Frontend production env

See [frontend/.env.production.example](../../../frontend/.env.production.example) on VPS as `.env.production.local` — includes `NEXT_PUBLIC_IMAGE_CDN_URL`, same-origin API URL; storefront flags from `GET /store/config`. Brand logo: `public/images/raghava-organics-logo.png` (`BRAND_LOGO_SRC`).

**Canonical extended pack:** [docs/clients/raghava-organics/VPS_DEPLOYMENT_PACK.md](../../../../docs/clients/raghava-organics/VPS_DEPLOYMENT_PACK.md) (media/CDN table, bootstrap `STOREFRONT_URL` boot guard, CI references).

**Backend bootstrap:** `STOREFRONT_URL` and `ADMIN_URL` are required in Phase 1 `.env`; production-like boot fails if `STOREFRONT_URL` is missing (password-reset email safety).
