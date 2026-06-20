# E-Commerce Backend — Antigravity Development Rules

> **Activation:** Always On
> **Scope:** All files in this workspace
> **Max Context:** This file is the single source of truth for AI agent behavior in this repository.

---

## 1. Project Identity

This is a **production-grade, multi-tenant e-commerce backend template** built for plug-and-play client instantiation. It powers D2C storefronts with a headless REST API architecture.

- **Runtime:** Node.js 20+ (LTS)
- **Framework:** Fastify 5 (with plugin-based architecture)
- **Language:** TypeScript 5+ (strict mode — `noEmit`, `strict: true`)
- **ORM:** Prisma 6 (PostgreSQL)
- **Cache/Queue:** Redis + BullMQ
- **Auth:** JWT (access + refresh token pair, RS256 recommended for production)
- **Payments:** Razorpay (primary), Stripe (secondary) — provider-agnostic service layer
- **Testing:** Vitest (unit + e2e + security)

---

## 2. Architecture Rules — MUST Follow

### Module Boundaries
- This is a **modular monolith**. Every domain lives in `src/modules/<domain>/`.
- Each module has exactly: `*.routes.ts`, `*.service.ts`, `*.schema.ts` (and optionally `*.controller.ts`).
- **NEVER** import from one module into another module directly. If modules need to communicate, use the service layer or events.
- Internal service modules (`payments`, `shipping`, `notifications`) are consumed by other modules but do NOT expose public HTTP routes.

### Plugin System
- All Fastify plugins live in `src/common/plugins/`.
- Every plugin MUST be wrapped in `fastify-plugin` (fp) for proper encapsulation.
- Plugin registration order in `src/app.ts` is intentional and load-bearing — do NOT reorder without understanding the dependency chain:
  ```
  helmet → cors → jwt → rate-limit → multipart → swagger
  prisma → redis → bullmq → observability → load-shed → modules
  ```

### File Naming
- Routes: `<module>.routes.ts`
- Services: `<module>.service.ts`
- Schemas: `<module>.schema.ts`
- Types/Interfaces: Colocated in the module, or in `src/common/types/` if shared.

---

## 3. Code Standards — MUST Follow

### TypeScript
- **NEVER** use `any`. Use `unknown` if the type is genuinely unknown, then narrow with type guards.
- All request/response types MUST be defined in the module's `*.schema.ts` using Fastify's JSON Schema or TypeBox.
- Use `const` by default. Use `let` only when reassignment is required. Never use `var`.
- Prefer `async/await` over raw `.then()` chains.
- All public functions MUST have JSDoc comments explaining purpose, params, and return.

### Error Handling
- Use Fastify's built-in error handling. Throw `createError()` from `@fastify/error` or `fastify.httpErrors`.
- All service methods MUST handle their own errors and return structured results. Never let raw Prisma/Redis errors leak to the client.
- Every route handler MUST have error handling — no unhandled promise rejections.

### Logging
- Use `request.log` (per-request logger with trace context) inside route handlers.
- Use `fastify.log` for application-level logging outside request context.
- **NEVER** use `console.log`, `console.error`, or `console.warn` anywhere in `src/`. Use the structured Fastify logger exclusively.

### Security
- All user input MUST be validated via JSON Schema before reaching the handler.
- Sensitive data (passwords, tokens, PII) MUST be redacted in all log output.
- All webhook endpoints MUST verify signatures (HMAC) before processing.
- Rate limiting is mandatory on all public endpoints.
- Admin routes MUST check both JWT validity AND admin role.

---

## 4. Data Rules — MUST Follow

### Prisma / Database
- Schema file: `prisma/schema.prisma` — this is the single source of truth for data models.
- All IDs are `UUID` (`@default(uuid())`). Never use auto-increment integers for primary keys.
- All monetary values are stored as `Int` in **paise** (₹1 = 100 paise). Never use `Float` or `Decimal` for money.
- All timestamps use `DateTime` with `@default(now())` and `@updatedAt` where applicable.
- After ANY schema change, you MUST run:
  ```bash
  npx prisma generate         # Regenerate the client
  npx prisma migrate dev      # Create and apply migration
  npm run typecheck            # Verify nothing broke
  ```
- Never use raw SQL queries unless absolutely necessary. Use Prisma's query builder.

### Redis
- Redis is for caching and session data ONLY. Never use it as a primary data store.
- All cache keys MUST follow the naming pattern: `<module>:<entity>:<id>` (e.g., `products:detail:abc-123`).
- All cached data MUST have a TTL. Never cache indefinitely.

### BullMQ
- Queue names follow: `<module>-<action>` (e.g., `orders-confirmation-email`).
- All jobs MUST be idempotent — they may be retried on failure.
- Workers live in `queues/workers/` — never put worker logic inside `src/modules/`.
- Dead letter queue (`dead-letter.worker.ts`) handles all permanently failed jobs.

---

## 5. Environment & Configuration

- All configuration is loaded from environment variables via `src/config/app.config.ts`.
- **NEVER** hardcode secrets, API keys, database URLs, or credentials anywhere in the codebase.
- Reference `.env.example` for the full list of required variables (80+).
- The app uses **fail-closed** defaults: if a required env var is missing, the server MUST refuse to start.
- When adding a new env var:
  1. Add it to `.env.example` with a descriptive comment
  2. Add validation in `src/config/app.config.ts`
  3. Add it to `docker-compose.yml` service environment section
  4. Document it in `docs/MASTER_DEPLOYMENT_PLAYBOOK.md`

---

## 6. Git & Workflow

### Branching (Trunk-Based Development)
- `main` — trunk, always deployable
- `feature/<description>` — short-lived feature branches (max 2–3 days)
- `fix/<description>` — bug fix branches
- `staging` — pre-production validation (merge from main)
- `production` — live deployment (merge from staging)

### Commit Convention
```
<type>(<scope>): <description>

Types: feat, fix, refactor, docs, test, chore, perf, security
Scope: module name or area (e.g., auth, cart, prisma, ci)
```

### Before Every PR
```bash
npm run typecheck              # Zero errors required
npm run lint                   # Zero warnings required
npm run test:unit              # All tests pass
npm run ci:reliability-gates   # Full 16-gate CI pipeline
```

---

## 7. Testing Standards

- **Unit tests:** Vitest, colocated with source or in `__tests__/` directories.
- **E2E tests:** Supertest against the running Fastify instance (`vitest.e2e.config.ts`).
- **Security tests:** Dedicated security-focused assertions (`vitest.security.config.ts`).
- **Governance tests:** Script-level tests for CI gates (e.g., `route-discipline-check.test.js`).
- **Worker tests:** MUST use dependency injection (pass mock `Worker`/`Queue`/`PrismaClient` via `deps` parameter) and MUST NOT use `vi.mock` on BullMQ or Prisma modules — `vi.mock` is incompatible with the `vmForks` pool.
- **Service tests:** MUST use `vi.spyOn(ServiceClass.prototype, 'methodName')` to mock dependent service methods rather than `vi.mock` on cross-service module paths — `vmForks` does not reliably intercept module boundaries.
- **Route tests:** MUST use a real Fastify instance with decorated mocks rather than `vi.mock`.
- Test files follow: `<module>.test.ts` or `<module>.spec.ts`.
- All new features MUST include tests. All bug fixes MUST include a regression test.

---

## 8. Documentation References

When you need deeper context on any area, reference these files (they are the source of truth):

| Document | Purpose | Location |
|----------|---------|----------|
| Architecture & Strategy | System design, module map, data flows | `ECOM_MASTER.md` |
| Technical Reference | API contracts, schemas, type definitions | `TRD.md` |
| Business Requirements | Feature specs, user stories, acceptance criteria | `BRD.md` |
| Deployment Operations | Docker, VPS setup, CI/CD, monitoring | `docs/MASTER_DEPLOYMENT_PLAYBOOK.md` |
| Architecture Decisions | ADR log — why decisions were made | `docs/DECISIONS.md` |
| Frontend Integration | How the Next.js frontend connects to this API | `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` |
| Go-Live Checklist | Pre-launch validation checklist | `docs/CLIENT_GO_LIVE_VALIDATION_GUIDE.md` |
| VPS Setup | Server provisioning for production | `docs/CLIENT_VPS_SETUP_GUIDE.md` |
| AI Frontend Prompts | Prompting guide for building the frontend | `starter-prompt.md` |

---

## 9. Forbidden Actions — NEVER Do These

- ❌ NEVER delete or modify files in `docs/` without explicit user approval
- ❌ NEVER delete `.agents/`, `.cursor/`, or any IDE config directories
- ❌ NEVER commit `.env` files (only `.env.example`)
- ❌ NEVER use `console.log` in source code
- ❌ NEVER use `any` type in TypeScript
- ❌ NEVER store money as Float/Decimal — always Int (paise)
- ❌ NEVER use auto-increment IDs — always UUID
- ❌ NEVER import across module boundaries directly
- ❌ NEVER skip input validation on any endpoint
- ❌ NEVER hardcode secrets, URLs, or credentials
- ❌ NEVER modify plugin registration order without understanding the full chain
- ❌ NEVER push directly to `staging` or `production` branches
- ❌ NEVER ignore failing tests or type errors
- ❌ NEVER blindly merge Dependabot major-version PRs (e.g., Prisma 5→7, TypeScript 5→6) — these require manual migration

---

## 10. Preferred Workflow for Changes

When asked to make changes to this codebase, follow this sequence:

1. **Understand** — Read the relevant module files and documentation first.
2. **Plan** — Outline the changes before making them. For significant changes, create an implementation plan artifact and request user review.
3. **Implement** — Make surgical, focused changes. Prefer small diffs over large rewrites.
4. **Validate** — Run `npm run typecheck` after every change. Run relevant tests.
5. **Document** — Update relevant docs if the change affects architecture, config, or API surface.

### For Prisma Schema Changes Specifically:
1. Modify `prisma/schema.prisma`
2. Run `npx prisma generate`
3. Run `npx prisma migrate dev --name <descriptive-name>`
4. Run `npm run typecheck`
5. Update `TRD.md` if the change affects API contracts
6. Update `ECOM_MASTER.md` if the change affects architecture

---

## 11. CI Reliability Gates

This project has 16+ automated CI gates. When making changes, be aware that these gates MUST pass:

- Route discipline check (AST-based)
- Serializer exposure check
- Config runtime parity check
- Admin contract check
- Admin layer drift check
- Docs runtime drift check
- Parity scorecard
- Deep endpoint smoke test
- Coverage ratchet check
- Environment runtime contract
- Edge policy drift check
- OpenTelemetry readiness check
- DR stale drill check
- Reliability release guard
- SLO burn rate simulation

All gate scripts live in `scripts/` and are executed via `npm run ci:reliability-gates`.

---

## 12. Dependency Management & Dependabot

### Pinned Versions
- This template pins **exact dependency versions** in `package.json`. When cloned for a new client, `npm install` installs exactly these versions — everything works out of the box.
- **NEVER** blindly update to a new major version of any core dependency (Prisma, TypeScript, Fastify, ESLint). Major versions contain breaking API changes.

### Dependabot PRs
- After pushing to GitHub, Dependabot will automatically open PRs proposing dependency upgrades. **This is expected behavior.**
- Red CI failures on Dependabot PRs do **not** mean the template is broken — they mean the proposed upgrade is incompatible with the current code.
- **Safe to merge:** GitHub Actions bumps and minor/patch npm bumps (if CI passes).
- **Close or ignore:** Major npm version bumps (Prisma, TypeScript, ESLint). Do these manually on a dedicated feature branch with proper migration effort.
- If Dependabot PRs are noisy, add `ignore` rules for major versions in `.github/dependabot.yml`.
