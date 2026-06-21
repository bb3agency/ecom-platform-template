# Documentation Context Map (Low-Noise Entry)

Use this map to keep AI/developer context small while ensuring no detail is lost.

## Development-time minimal load set (read first)

1. `docs/MASTER_DEPLOYMENT_PLAYBOOK.md` — end-to-end build/deploy SOP (now shortened; detailed hardening moved out).
2. `docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md` — strict phase sequencing and evidence gates.
3. `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` — frontend contract + slice methodology.
4. `docs/API_ENDPOINT_INDEX.md` — endpoint inventory mapped to frontend/admin/ops UI surfaces.
5. `docs/ENV_VS_DB_CONFIG_REFERENCE.md` — authoritative config source-of-truth (env vs DB), validation/alerting, recent hardening.
6. `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md` — step-by-step Phase 1/2 model: what goes in `.env` vs Ops UI, ops-newuser flow.
7. `docs/GITHUB_CD_SELF_HOSTED_RUNNER_GUIDE.md` — push-to-deploy: one self-hosted runner per client repo, Variables/Secrets, monorepo workflow paths.
8. `docs/BACKEND_GO_LIVE_CHECKLIST.md` — backend release/parity gate.
9. `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` — frontend release gate.

## Development-time supporting references (read only when needed)

- `docs/ROUTE_SURFACE_COMPLETE_REFERENCE.md` — deep per-route reference: what every route does, permissions, data touched, flows, hard boundaries, and what cannot be done.
- `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` — provider setup/rotation/incident policy.
- `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md` — credential ownership artifact.
- `docs/CLIENT_DEV_LOG_TEMPLATE.md` — client build log template.
- `docs/FRONTEND_DEV_LOG_TEMPLATE.md` — frontend slice-tracker template.
- `docs/CLIENT_VPS_DEPLOYMENT_LOG_TEMPLATE.md` — VPS-phase execution log template.
- `docs/OPS_CONTROL_PLANE_GUIDE.md` — detailed ops control-plane behavior.
- Error handling canon: `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` section `2.1` (frontend error-code handling matrix) + section `2.1.1` (admin form validation UX) + `docs/CLIENT_VPS_SETUP_GUIDE.md` section `19.1` (VPS/API error triage matrix).
- `docs/CLOUDFLARE_SHARED_VPS_DEPLOYMENT_GUIDE.md` — battle-tested Cloudflare + shared-VPS runbook (companion to `docs/CLIENT_VPS_SETUP_GUIDE.md`): `Full (strict)` TLS, certless-`default_server` **525** root cause, `AAAA`/`Flexible` pitfalls, origin-IP lock, permanent default-server block, per-client onboarding checklist, and the CD-runner-per-client + OOM lessons.
- `docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md` — multi-client platform versioning: semver'd `backend-core`/`frontend-core`, changelog-as-propagation-recipe, per-client `PLATFORM_VERSION` pinning, design-token contract, `FEATURE_*`-flag feature differences, and the `check-core-drift.sh` / `check-token-contract.sh` CI gates. **§9** = release-train automation (`release-train.yml` + `core-sync.yml` + `sync-core.mjs`); **§12** = the develop→cherry-pick→tag→fan-out flow; **§13/§13.1** = new-client onboarding + all required keys/secrets. Builds on `CO_DEVELOPMENT_SYNC_GUIDE.md`.
- `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md` — real incident replay and deterministic remediation for Phase 7 VPS backend deploy.
- `docs/templates/client-GITHUB_CD_SETUP.template.md` — per-client filled CD checklist (`GITHUB_CD_SETUP.md`).
- `docs/HARDENING_HISTORY.md` — full engineering hardening narrative (reference-only during active delivery). **Latest:** June 10, 2026 pass 2 — order/payment/coupon/storefront integration hardening + runtime `GET /store/config` (see also same-day production readiness pass for logo/boot/notification/CI).
- `docs/DECISIONS.md` — architectural decision ledger.

## Post-development primary set

- `docs/CLIENT_HANDOFF_INDEX.md` (entrypoint)
- `docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`
- `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`
- `docs/API_ENDPOINT_INDEX.md`
- `docs/ENV_VS_DB_CONFIG_REFERENCE.md`
- `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`
- `.env.example`
- `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md`
- Completed client artifacts (`CLIENT_DEV_LOG.md`, `FRONTEND_DEV_LOG.md`, `CLIENT_VPS_DEPLOYMENT_LOG.md`)

## Consolidation notes (to reduce file sprawl without detail loss)

- Co-development command ownership is consolidated into `CO_DEVELOPMENT_SYNC_GUIDE.md`; other docs keep short pointers only.
- Future shipping extension guidance is consolidated into `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` section `1.2.2A`.
- Detailed hardening narrative is consolidated into `docs/HARDENING_HISTORY.md`; master playbook keeps only operational highlights.
- Duplicate decision entries are removed from `docs/DECISIONS.md` where exact same decision already existed earlier.
