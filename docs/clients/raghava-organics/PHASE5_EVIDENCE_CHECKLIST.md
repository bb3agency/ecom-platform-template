# Phase 5 evidence — Raghava Organics

Complete on **production domain** after Phases 7–10.

## Postman E2E

- [ ] Folder 0 — health / auth bootstrap
- [ ] Folder 1 — catalogue / cart
- [ ] Folder 2 — checkout PREPAID + COD
- [ ] Folder 3 — admin / ops flows
- [ ] Evidence saved (export or screenshot log with date)

Workspace: backend Postman collection per [backend/docs/postman/](../../../backend/docs/postman/)

## Provider dry-runs (Ops UI after Phase 8)

| Provider | Done | Date | Notes |
|----------|------|------|-------|
| Resend email | [ ] | | |
| Razorpay test/live | [ ] | | |
| Delhivery or Shiprocket | [ ] | | |
| MSG91 / SMS | [ ] | | |

## Go-live checklists

- [ ] [BACKEND_GO_LIVE_CHECKLIST.md](../../../backend/docs/BACKEND_GO_LIVE_CHECKLIST.md) — all sections on prod
- [ ] [FRONTEND_AI_GO_LIVE_CHECKLIST.md](../../../backend/docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md)
- [ ] [CLIENT_GO_LIVE_VALIDATION_GUIDE.md](../../../backend/docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md)

## Production smoke URLs

- [ ] `https://<domain>/api/v1/health`
- [ ] `https://<domain>/` storefront loads
- [ ] `https://<domain>/admin/login`
- [ ] `https://<domain>/ops/login` (Basic Auth if configured)

Update [frontend/docs/FRONTEND_DEV_LOG.md](../../../frontend/docs/FRONTEND_DEV_LOG.md) Phase 5 table when complete.
