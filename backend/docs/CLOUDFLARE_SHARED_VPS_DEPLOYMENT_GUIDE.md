# Cloudflare + Shared-VPS Deployment Guide (Battle-Tested)

> **Status:** Client-Main (Post-Development) companion runbook.
> **Pairs with:** `docs/CLIENT_VPS_SETUP_GUIDE.md` (the canonical multi-client setup). This doc captures the **real-world Cloudflare integration + troubleshooting lessons** that the setup guide does not, learned while bringing two proxied/direct stores live on one VPS (raghava-organics + sbgs, 2026-06).
> **Read this whenever:** a Cloudflare-proxied site returns **525 / 521 / 502**, you are onboarding a new client onto a shared VPS, or you need the correct end-to-end TLS posture.

---

## 0. TL;DR — the rules that prevent every issue we hit

1. **SSL/TLS mode = `Full (strict)`.** Never `Flexible` (causes an infinite redirect loop — see §3.1). Never `Full (non-strict)` long-term (accepts forged origin certs).
2. **The origin must serve a valid, publicly-trusted cert on the *default* server block**, not just the domain-named block — Cloudflare's strict validation reaches the origin **without a matching SNI** (see §2). A certless or self-signed `default_server` ⇒ **525**.
3. **Never leave the stock `/etc/nginx/sites-enabled/default`** in place — it ships a *certless* `listen 443 ssl default_server` that breaks every proxied site under Full (strict). Remove it.
4. **DNS: one `A` record per name → VPS IPv4, Proxied (orange).** No stray `AAAA` records unless Nginx listens on IPv6 (see §3.2).
5. **Inside Docker Compose, reach Redis by service name `redis:6379`** — `host.docker.internal` is only for the **host Postgres**.
6. **Unique credentials per client** — DB password, Redis password, JWT secrets. Never copy another client's `.env` secrets.
7. **Lock the origin to Cloudflare IPs** so the raw VPS IP can't serve the site or be used to bypass Cloudflare (see §4).
8. **Never run `certbot --nginx` on these server blocks** — it rewrites the templated maintenance-gate/rate-limit config. Use `certbot certonly` (webroot/standalone) instead.

---

## 1. Reference architecture (shared VPS)

| Client slot N | Backend host port | Storefront port | Docker project / network | Redis container |
| --- | --- | --- | --- | --- |
| 1 | 3001 | 3101 | `<client-id>` / `<client-id>_client-network` | `<client-id>-redis` |
| 2 | 3002 | 3102 | … | … |
| N | 3000+N | 3100+N | … | … |

- **Backends + workers + Redis** run in a per-client Docker Compose stack (`COMPOSE_PROJECT_NAME=<client-id>`).
- **Frontends** run under **PM2** (`<client-id>-frontend`, port `310N`). Run `pm2 save` after adding one, and ensure `pm2 startup` is enabled once per VPS so they survive reboot.
- **Host PostgreSQL** is shared (one DB + one DB user per client). Containers reach it via `host.docker.internal:5432` (requires `extra_hosts: "host.docker.internal:host-gateway"` in compose).
- **Nginx** terminates TLS on the host, one `server {}` per domain rendered from `nginx/client.conf.template`.

---

## 2. Why Cloudflare 525 happens on a healthy origin (root cause)

**Symptom:** Site returns `525 SSL handshake failed` from Cloudflare, but the origin is demonstrably healthy:
```bash
# Both of these return HTTP 200 with a valid LE cert:
curl -k --resolve <domain>:443:<vps-ip> -I https://<domain>/api/v1/health
echo | openssl s_client -connect <vps-ip>:443 -servername <domain> 2>/dev/null | grep "Verify return code"
# => Verify return code: 0 (ok)
```

**Cause:** Cloudflare's **Full (strict) origin-certificate validation reaches the origin on a path that does not carry a matching SNI**, so it lands on Nginx's **`default_server`** block — *not* the domain-named block. If that default block has **no certificate** (the stock Ubuntu default) or a **self-signed** one, the strict validation fails and Cloudflare returns 525 for *all* requests to that zone — even though normal SNI-carrying requests would route fine.

**Proof from the field:**
| Default `server {}` on :443 | Cloudflare result |
| --- | --- |
| stock `listen 443 ssl default_server` **with no `ssl_certificate`** | **525** |
| self-signed cert | **525** |
| valid, publicly-trusted LE cert | **200** ✅ |

**Diagnostic that pinpoints it** — a **no-SNI** handshake returning empty = the default block has no usable cert:
```bash
echo | openssl s_client -connect <vps-ip>:443 2>/dev/null | grep -E "subject=|issuer="   # empty => broken default
```

**Implication for multi-client:** Multiple Cloudflare-proxied clients on one VPS **work fine** — normal requests route by SNI to each domain block — *provided the default block always presents one valid, trusted cert.* See §5 for the permanent pattern.

---

## 3. Cloudflare configuration (per zone)

### 3.1 SSL/TLS mode — `Full (strict)` only

- **`Flexible` is forbidden.** Our Nginx port-80 block does an unconditional `return 301 https://...`. Under Flexible, Cloudflare connects to the origin over **http:80**, gets a 301 to https, re-requests http:80 → **infinite redirect loop** (`ERR_TOO_MANY_REDIRECTS`). Flexible also disables real end-to-end encryption that the app's HSTS headers assume.
- **`Full (non-strict)`** accepts any origin cert (including forged) — acceptable only as a temporary unblock, never the resting state.
- **`Full (strict)`** is correct: the origin has a valid Let's Encrypt cert. Requires the default-block fix in §2/§5.

### 3.2 DNS records

- One **`A`** record per name (`@`, `www`) → **VPS IPv4**, **Proxied (orange)**.
- **No `AAAA` record** unless Nginx explicitly listens on IPv6 (`listen [::]:443 ssl;`). A stray AAAA pointing at an address where Nginx isn't listening ⇒ Cloudflare tries IPv6 origin → connection refused → 525. (We add IPv6 listeners as defense-in-depth anyway — harmless.)
- Verify proxy status from **public DNS** (ground truth, not the dashboard tab):
  ```bash
  dig +short <domain>     # Proxied => Cloudflare IPs (104.x / 172.67.x); DNS-only => raw VPS IP
  ```
- Email/CDN records (`MX`, `TXT`/DKIM/SPF/DMARC, R2 `cdn` CNAME) are independent of proxy status — leave them.

### 3.3 Proxied vs DNS-only

- **Proxied (orange):** Cloudflare benefits (DDoS, caching, hidden origin). Requires §2/§5 default-block fix + §4 origin lock. **Preferred.**
- **DNS-only (grey):** browser hits the origin directly with the LE cert. Simplest, but exposes the origin IP and forgoes Cloudflare protection. Acceptable interim, not the target state.

---

## 4. Origin lock (block the raw VPS IP)

Because Cloudflare reaches the origin without a usable SNI (§2), raw-IP visitors and Cloudflare both land on the default block — you **cannot** blanket-`return 444` the raw IP without also breaking Cloudflare. The correct fix is to **allow only Cloudflare's IP ranges** on the proxied site's server block. This also hardens against attackers bypassing Cloudflare via the origin IP.

```bash
# /etc/nginx/snippets/cloudflare-only.conf  — refresh from https://www.cloudflare.com/ips/
sudo tee /etc/nginx/snippets/cloudflare-only.conf >/dev/null <<'EOF'
allow 173.245.48.0/20; allow 103.21.244.0/22; allow 103.22.200.0/22;
allow 103.31.4.0/22;  allow 141.101.64.0/18; allow 108.162.192.0/18;
allow 190.93.240.0/20; allow 188.114.96.0/20; allow 197.234.240.0/22;
allow 198.41.128.0/17; allow 162.158.0.0/15; allow 104.16.0.0/13;
allow 104.24.0.0/14;  allow 172.64.0.0/13;  allow 131.0.72.0/22;
allow 2400:cb00::/32; allow 2606:4700::/32; allow 2803:f800::/32;
allow 2405:b500::/32; allow 2405:8100::/32; allow 2a06:98c0::/29;
allow 2c0f:f248::/32;
deny all;
EOF
```
Include it inside the proxied site's `443` server block, e.g. after the `listen [::]:443 ssl;` line. Result: Cloudflare IPs → 200, raw-IP browsers → 403.

> ⚠️ This edit lives in the **rendered** Nginx config. A redeploy that re-renders from `client.conf.template` drops it. Either re-apply, or bake the `include` into the template (recommended — see §6).

---

## 5. Permanent default-server block (bulletproof multi-client)

Instead of relying on "whichever client's server block loaded first" being the default, install **one dedicated default block** with a long-lived **Cloudflare Origin CA certificate** (15-year, trusted by Cloudflare under Full strict). Every current and future proxied client's strict-validation probe then passes, and raw-IP is denied — with **zero per-client Nginx hacks**.

1. Cloudflare dashboard (any zone) → **SSL/TLS → Origin Server → Create Certificate** → save the cert + key to the VPS (e.g. `/etc/nginx/ssl/cf-origin.pem` / `.key`).
2. Create the default block:
   ```nginx
   # /etc/nginx/sites-available/000-default.conf
   server {
     listen 80 default_server;
     listen [::]:80 default_server;
     server_name _;
     return 444;
   }
   server {
     listen 443 ssl default_server;
     listen [::]:443 ssl default_server;
     server_name _;
     ssl_certificate     /etc/nginx/ssl/cf-origin.pem;
     ssl_certificate_key /etc/nginx/ssl/cf-origin.key;
     ssl_protocols TLSv1.2 TLSv1.3;
     include /etc/nginx/snippets/cloudflare-only.conf;   # raw-IP => 403; CF probe => valid cert
     return 444;                                         # CF strict probe only needs the handshake to succeed
   }
   ```
3. `sudo ln -sf /etc/nginx/sites-available/000-default.conf /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx`
4. Verify each proxied domain still returns 200 and the raw IP returns 403/444.

> If you adopt this, you no longer need the per-client `cloudflare-only.conf` include inside each domain block (the default block + per-domain certs cover validation + routing). Keep per-domain blocks free of the origin-lock so direct/grey-cloud clients still work.

---

## 6. New-client onboarding checklist (shared VPS)

Run top-to-bottom for each new client. Slot N → backend `300N`, storefront `310N`.

**Host prerequisites (once per VPS):**
- [ ] Swap configured (≥2 GB) — a 4 GB box runs out of RAM around the 3rd stack. (`/swapfile` in `/etc/fstab`.)
- [ ] `pm2 startup` enabled; `pm2 save` after each frontend.
- [ ] No native host `redis-server` running (clients use containerized Redis): `sudo systemctl disable --now redis-server` if present and empty.
- [ ] Stock Nginx default removed; permanent `000-default.conf` (§5) installed.
- [ ] UFW: only `22/80/443` inbound (+ Postgres restricted to the Docker subnet).

**Per client:**
- [ ] **DNS:** `A` `@` + `www` → VPS IPv4, Proxied. No stray `AAAA`. Verify with `dig +short`.
- [ ] **Cloudflare SSL/TLS:** `Full (strict)`.
- [ ] **Postgres:** unique DB + unique DB user + **unique strong password** (`CREATE DATABASE`, `CREATE USER`, grants). DB name uses underscores only.
- [ ] **`.env`:** unique `CLIENT_ID`, `COMPOSE_PROJECT_NAME=<client-id>`, `BACKEND_PORT=300N`, `STOREFRONT_PORT=310N`, `DATABASE_URL` → `host.docker.internal`, `REDIS_URL` → `redis:6379` with a **unique** Redis password, unique `JWT_SECRET`/`JWT_REFRESH_SECRET`/`OPS_DB_ENCRYPTION_KEY`.
- [ ] **TLS cert:** `sudo certbot certonly --webroot -w /var/www/html -d <domain> -d www.<domain>` (never `--nginx`).
- [ ] **Nginx:** render from `nginx/client.conf.template` via envsubst (`CLIENT_DOMAIN`, `STOREFRONT_PORT`, `BACKEND_PORT`), symlink, `nginx -t`, reload.
- [ ] **Backend:** `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` (prod overlay hides host Postgres + unpublishes Redis).
- [ ] **Frontend:** `pm2 start npm --name "<client-id>-frontend" -- start` then `pm2 save`.
- [ ] **Verify:** `curl http://localhost:300N/api/v1/health` → `db+redis connected`; `dig +short <domain>` → CF IPs; `curl -I https://<domain>/api/v1/health` → 200; raw IP → 403/444.

---

## 6.1 GitHub Actions CD runner (one per client)

Push-to-deploy uses a **self-hosted runner per client repo**, each in its own directory with a **unique label**. Never share a runner between clients and never clone a configured runner directory.

- Layout: `/home/<user>/actions-runner` (client 1), `/home/<user>/actions-runner-<client2>` (client 2), …
- Register against the client repo with a registration token from **GitHub → repo → Settings → Actions → Runners → New self-hosted runner**. Run `config.sh` as a **single unbroken line** with `--unattended` — a broken line-continuation silently drops `--name/--labels/--unattended` and forces interactive prompts:
  ```bash
  cd /home/<user>/actions-runner-<client> && ./config.sh \
    --url https://github.com/<org>/<client>-site --token <TOKEN> \
    --name <client>-vps --labels <client>-vps --unattended --replace
  sudo ./svc.sh install <user> && sudo ./svc.sh start
  sudo systemctl is-active 'actions.runner.<org>-<client>-site.<client>-vps.service'
  ```
- **Set the GitHub Variable `VPS_RUNNER_LABEL=<client>-vps`** in each client repo (Settings → Secrets and variables → Actions → Variables). Without it the workflow falls back to the generic `self-hosted` label and may route one client's deploy to another client's runner.
- **Do NOT clone a configured runner dir** (`cp -r` of an existing runner) — it copies the other client's identity/credentials and `svc.sh` then tries to create the wrong service name. Always download a fresh runner tarball matching the in-use version.
- **OOM watch:** runner deploy jobs run `next build`, which can peak >2 GB. On a 4 GB box this OOM-kills the runner service mid-deploy (`Active: failed (Result: oom-kill)`). Ensure swap is configured (§6 host prerequisites) before relying on CD; consider capping build memory for very small hosts.

---

## 7. Pitfalls table (everything we actually hit)

| Symptom | Root cause | Fix |
| --- | --- | --- |
| Backend `EAI_AGAIN redis` / `ETIMEDOUT` in container | `REDIS_URL` used `host.docker.internal` | Use service name `redis:6379` |
| Cloudflare **525** on a healthy origin | certless/self-signed `default_server` (CF strict probe is no-SNI) | Valid trusted cert on the default block (§2/§5); remove stock default |
| Cloudflare **525** intermittent | stray `AAAA` record, Nginx not on IPv6 | Remove AAAA or add `listen [::]:443 ssl` |
| `ERR_TOO_MANY_REDIRECTS` | Cloudflare `Flexible` + origin 80→443 redirect | Set `Full (strict)` |
| Raw VPS IP serves the store | proxied client is the de-facto default block | Origin lock (§4) / permanent default (§5) |
| Frontend dies on logout/reboot | started manually, not under PM2 | `pm2 start … && pm2 save`; ensure `pm2 startup` |
| `conflicting server name … ignored` (nginx -t) | duplicate vhost for same `server_name` | Remove the stale `sites-enabled` symlink |
| Compose makes orphaned containers | missing `COMPOSE_PROJECT_NAME` | Set it `=<client-id>` in `.env` |
| Two clients reachable with one leaked password | shared DB/Redis password | Rotate to unique per-client secrets |
| OOM kills under load with 3+ clients | no swap on a 4 GB box | Add ≥2 GB swap |
| CD runner service `failed (Result: oom-kill)` mid-deploy | `next build` peaked >2 GB on a 4 GB box | Add swap (§6); cap build memory on tiny hosts |
| GitHub routes one client's deploy to another's runner | shared/generic runner label | Unique `--labels <client>-vps` + repo Variable `VPS_RUNNER_LABEL` (§6.1) |
| New runner `svc.sh install` creates the wrong service name | cloned a configured runner dir | Fresh runner tarball + `config.sh` per repo (§6.1) |

---

## 8. Maintenance

- **Cert renewal:** `certbot.timer` auto-renews. Because we use `certonly` (not `--nginx`), ensure a deploy hook reloads Nginx: `--deploy-hook "systemctl reload nginx"` (or a script in `/etc/letsencrypt/renewal-hooks/deploy/`).
- **Cloudflare IP ranges:** rarely change; refresh `/etc/nginx/snippets/cloudflare-only.conf` from <https://www.cloudflare.com/ips/> if origin-locked sites start 403'ing legitimate CF traffic.
- **Capacity:** watch `free -h` and `df -h`; the canonical thresholds are in `docs/CLIENT_VPS_SETUP_GUIDE.md` §2.

---

> **Template propagation:** This doc and any matching `client.conf.template` / script changes are **template-worthy** — sync to the backend template repo and to other active client repos. Per the co-development rules, **propose** the push/PR and get explicit approval before any remote mutation.
