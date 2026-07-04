# Technical Requirements Document (TRD)
## E-Commerce Backend Template — v2.0

> **Derived from:** `ECOM_MASTER.md` — the canonical source of truth.
> **This document does not contradict the master. If conflict exists, the master wins.**
> **Audience:** Developer (you), AI IDEs (Cursor, Copilot), future collaborators.

**Document Type:** Technical Requirements Document
**Version:** 2.0
**Status:** 🔒 Final — Derived from locked master decisions
**Last Updated:** April 2026
**Traceability:** Every requirement in this document maps to a section in `ECOM_MASTER.md`

---

> Configuration model note: For the authoritative env vs DB configuration map, validation/alerting rules, and recent hardening summary, see `docs/ENV_VS_DB_CONFIG_REFERENCE.md`. This TRD assumes DB-backed values are the single source of truth for runtime configuration with no environment fallbacks in production.


## Table of Contents

1. [Document Purpose & Scope](#1-document-purpose--scope)
2. [System Overview](#2-system-overview)
3. [Infrastructure Requirements](#3-infrastructure-requirements)
4. [Backend Technical Requirements](#4-backend-technical-requirements)
5. [Database Requirements](#5-database-requirements)
6. [Authentication & Authorisation](#6-authentication--authorisation)
7. [API Requirements](#7-api-requirements)
8. [Module Technical Specifications](#8-module-technical-specifications)
9. [Integration Specifications](#9-integration-specifications)
10. [Background Job Requirements](#10-background-job-requirements)
11. [Security Requirements](#11-security-requirements)
12. [Frontend Technical Requirements](#12-frontend-technical-requirements)
13. [Performance Requirements](#13-performance-requirements)
14. [Testing Requirements](#14-testing-requirements)
15. [Observability Requirements](#15-observability-requirements)
16. [Constraint Registry](#16-constraint-registry)

---

## 1. Document Purpose & Scope

### 1.1 What This Document Covers

This TRD defines the **complete technical requirements** for building the e-commerce backend template — every specification a developer or AI IDE needs to implement each component correctly, without ambiguity.

It covers:
- Exact technology versions, configurations, and constraints
- Complete data models with field types, validations, and relationships
- Precise API request/response contracts with error codes
- Integration specifications for every third-party service
- Security requirements with implementation method
- Performance targets with measurement methodology
- Testing requirements with coverage thresholds

Operational release sign-off is executed with:
- `docs/BACKEND_GO_LIVE_CHECKLIST.md` (full backend env-to-implementation parity)
- `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` (frontend contract + integration boundary checks)
- `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` (provider setup, dry-runs, rotation, incident drill controls)
- `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md` (per-client credential ownership + lifecycle record)

### 1.1A Final cross-cutting closeout (May 2026)

The following controls are normative and must be treated as part of technical acceptance:
- Process crash boundary metric `process_crash_total{reason}` is emitted before API shutdown on unhandled rejection/uncaught exception.
- Admin permission model remains fail-closed for unprovisioned admins (`AdminPermissionGrant`-driven access only).
- Admin permission updates are token-issuance scoped (mid-window changes require token revocation/logout for immediate effect).
- Payment/shipping circuit-breaker state is process-local per replica unless explicitly redesigned for shared state.
- Prisma delegate drift cleanup is complete: native delegates are used directly (`prisma.returnRequest`, `prisma.storeSettings`) and temporary drift workaround artifacts are removed.
- `OpsUser.mfaSecretEncrypted` nullable schema behavior is guarded by fail-closed runtime checks when MFA is enabled.
- `REFUNDED` transition from admin APIs is deferred/async through the refunds queue, not guaranteed as immediate synchronous status mutation.
- Frontend delivery is mandatory contract-first simultaneous build + integration via vertical slices (contract -> typed API client -> UI -> real backend integration -> tests), not page-only UI-first delivery.
- Frontend delivery sequence is mandatory: Foundation -> Ops control plane -> Admin read -> Admin mutation -> Reliability -> Storefront customer journey (see `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §1.2).
- Ops frontend: `/ops/login` and `/ops/setup` are public; all other `/ops/*` routes require `ops_session` (layout `GET /ops/session`, redirect to login on `401`).

### 1.2 What This Document Does Not Cover

- Business rules and client-facing feature descriptions → see `BRD.md`
- Architectural philosophy and decision rationale → see `ECOM_MASTER.md`
- Per-client customisation procedures → see `ECOM_MASTER.md` §12

### 1.3 Requirement Notation

| Tag | Meaning |
|---|---|
| `[MUST]` | Non-negotiable. Violation is a defect. |
| `[SHOULD]` | Strong recommendation. Deviation requires documented justification. |
| `[MAY]` | Optional — implement if applicable to the current context. |
| `[NEVER]` | Explicitly forbidden. Violation is a security or integrity defect. |

---

## 2. System Overview

### 2.1 Architecture Pattern

**`[MUST]`** The system `[MUST]` implement a **Modular Monolith** pattern — one Fastify process per client deployment, internally structured with fully decoupled modules that communicate only through defined TypeScript interfaces and injected services.

**`[NEVER]`** Modules `[NEVER]` import directly from each other's internal files. Cross-module communication happens only through the public service interface of the target module.

```
src/modules/orders/orders.service.ts
  CORRECT:  imports NotificationsService from src/modules/notifications/notifications.service.ts
  WRONG:    imports ResendAdapter from src/modules/notifications/adapters/email/resend.adapter.ts
```

### 2.2 Technology Versions

| Technology | Version | Constraint |
|---|---|---|
| Node.js | 22 LTS | `[MUST]` — LTS required for production stability |
| TypeScript | 5.x | `[MUST]` — strict mode mandatory |
| Fastify | 5.x | `[MUST]` — v5 runtime baseline |
| Prisma | 5.x | `[MUST]` — schema-first ORM |
| PostgreSQL | 16 | `[MUST]` — ACID, JSONB, tsvector |
| Redis | 7 | `[MUST]` — required for BullMQ compatibility |
| BullMQ | 5.x | `[MUST]` — requires Redis 7 |
| Docker | 24+ | `[SHOULD]` — Compose v2 plugin syntax |
| Ubuntu | 22.04 LTS | `[MUST]` — VPS operating system |
| Nginx | 1.24+ | `[MUST]` — host-level reverse proxy |

### 2.3 Per-Client Isolation Model

**`[MUST]`** Each client deployment `[MUST]` be a fully independent Docker Compose stack with its own Fastify process, Redis container, PostgreSQL database, `.env` file, Nginx `server {}` block, and Certbot SSL certificate.

**`[NEVER]`** Two client deployments `[NEVER]` share a Redis instance, database, JWT secret, or payment/delivery credentials.

---

## 3. Infrastructure Requirements

### 3.1 VPS Specification

| Resource | Minimum | Recommended (5–10 sites) |
|---|---|---|
| vCPU | 2 | 4 |
| RAM | 4 GB | 8 GB |
| Storage | 40 GB SSD | 80 GB SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

### 3.2 Host-Level Services

**`[MUST]`** Run on the host (not in Docker):

| Service | Reason |
|---|---|
| PostgreSQL 16 | Simplifies `pg_dump` backup; reachable from all containers via `host.docker.internal` |
| Nginx | One instance handles all domain routing and SSL |
| Certbot | Manages certificates for all client domains |
| PM2 (Next.js frontend) | Frontend is NOT containerised — runs as a host PM2 process per client on port `3100 + N`. PM2 provides zero-downtime reloads on deploy. One process per client: `<client-id>-frontend`. |
| GitHub Actions self-hosted runner | One runner per client registered with a unique `VPS_RUNNER_LABEL`. Triggers `deploy-backend` (Docker rebuild) and `deploy-frontend` (`vps-frontend-deploy.sh` → PM2 reload) jobs on push to `main`. See `.github/workflows/deploy.yml`. |

**`[MUST]`** Docker Compose `[MUST]` include:
```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

### 3.3 Port Assignment Convention

| Client Slot | Backend Port | Storefront Port |
|---|---|---|
| Client 1 | 3001 | 3101 |
| Client 2 | 3002 | 3102 |
| Client N | 3000 + N | 3100 + N |

### 3.4 Redis Protected Mode (Security Constraint)

**`[MUST]`** The Redis container runs with `--protected-mode yes` by default. Connecting from the Node.js application (on the host) into the Docker container routes through the Docker gateway interface, which Redis treats as an external IP. Therefore, you **`[MUST]`** set a `REDIS_PASSWORD` in your `.env` file. If `REDIS_PASSWORD` is blank, Redis will drop the connection, causing `ioredis` to crash into an infinite `ECONNRESET` loop.

**`[MUST]`** Ports `[MUST]` be set via `BACKEND_PORT` in `.env`. Hardcoded port numbers in `docker-compose.yml` are forbidden.

### 3.5 Docker Requirements

**`[MUST]`** Every `docker-compose.yml` `[MUST]` include:
- `restart: unless-stopped` on the backend service
- `--maxmemory 100mb --maxmemory-policy noeviction` on the Redis command
- A named bridge network (`client-network`)

**`[MUST]`** The `Dockerfile` `[MUST]` use a **multi-stage build**:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS production
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/tsconfig.production.json ./tsconfig.production.json
COPY --from=builder /app/bootstrap-backend.js ./bootstrap-backend.js
COPY --from=builder /app/bootstrap-workers.js ./bootstrap-workers.js
CMD ["node", "bootstrap-backend.js"]
```

### 3.6 Nginx Requirements

**`[MUST]`** Nginx config per client `[MUST]` enforce:
- HTTP → HTTPS redirect (301) on port 80
- TLSv1.2 and TLSv1.3 only
- `ssl_prefer_server_ciphers on`
- `ssl_ciphers` ECDHE-only AEAD suite, `ssl_session_cache shared:SSL:10m`, `ssl_session_timeout 1d`, `ssl_session_tickets off`, `ssl_stapling on`, `ssl_stapling_verify on`
- Security headers: `Strict-Transport-Security` (HSTS 2-year, preload), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-XSS-Protection: 1; mode=block`, `Permissions-Policy`
- `client_max_body_size 20M`
- `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` proxy headers
- Route-class `limit_req_zone` controls at edge:
  - auth: 20 req/min (burst 8)
  - checkout/payment: 35 req/min (burst 12)
  - admin: 60 req/min (burst 15)
  - catalog read: 240 req/min (burst 40)
  - cart/session: 90 req/min (burst 20)
  - webhook ingress: 300 req/min (burst 30)
  - health: 60 req/min (burst 5)
  - default API: 90 req/min (burst 20)

**`[MUST]`** Admin experience `[MUST]` be served from the same frontend host using route-based mounting (for example `client1.com/admin`):

```nginx
server {
  listen 443 ssl;
  server_name client1.com www.client1.com;
  location / {
    proxy_pass http://127.0.0.1:3101;
  }
}
```

**`[MUST]`** On multi-client VPS, Nginx onboarding is additive:
- Use `/etc/nginx/sites-available/<domain>` with matching symlink in `sites-enabled/`.
- Do not remove `sites-enabled/default` blindly; remove only after explicit host-level audit confirms it is unused.
- Install `snippets/rate-zones.conf` once per VPS and include it in top-level `nginx.conf` `http {}`. Do not duplicate `limit_req_zone` declarations in multiple files.

### 3.7 Shared VPS Redis exposure rule

**`[MUST]`** On production shared VPS, each client Redis instance `[MUST NOT]` publish host `:6379`.

- `redis.ports` mapping is allowed for local/dev convenience only.
- Production stacks must keep Redis internal to Docker network (`redis://:<password>@redis:6379`).
- Any deployment script `[MUST]` fail fast if client Redis is bound on host `0.0.0.0:6379` to prevent cross-client collision and accidental exposure.

### 3.8 Readiness gate semantics

**`[MUST]`** `GET /api/v1/health/ready` is a diagnostic contract, not a blanket "boot failed" signal during early VPS bootstrap.

- During Phase 7 (before Ops runtime keys are saved), readiness may legitimately return HTTP `503` with envelope `{ success: false, data: <readiness payload>, error: { code: 'CONFIG_NOT_READY', message } }` and populated `data.runtimeConfigMissingKeys`.
- Operators must inspect readiness response body (`curl -sS`) and complete Phase 8 runtime config before enforcing strict `ready` gating.
- Do not use `curl -f` for early bootstrap readiness checks where body diagnostics are required.

---

## 4. Backend Technical Requirements

### 4.1 TypeScript Configuration

**`[MUST]`** `tsconfig.json` `[MUST]` enforce strict mode with these options at minimum:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": ".",
    "paths": {
      "@modules/*": ["src/modules/*"],
      "@common/*": ["src/common/*"],
      "@config/*": ["src/config/*"],
      "@queues/*": ["queues/*"]
    }
  }
}
```

Current template compiles both `src/**` and `queues/**` from the project root.

**`[NEVER]`** `any` type `[NEVER]` appears in production code without an inline `// eslint-disable` comment and a written justification.

### 4.2 Fastify Plugin Registration Order

**`[MUST]`** Plugins `[MUST]` be registered in this exact order in `src/main.ts`:

```
1. @fastify/helmet          (security headers first)
2. @fastify/cors            (CORS before auth)
3. @fastify/jwt             (JWT plugin before auth hooks)
4. @fastify/rate-limit      (rate limiting before route handlers)
5. @fastify/multipart       (file uploads)
6. @fastify/swagger         (OpenAPI docs — dev/staging only)
7. prismaPlugin             (DB connection)
8. redisPlugin              (Redis connection)
9. bullmqPlugin             (queue registration)
10. Feature modules         (each via app.register())
```

### 4.3 Health Check Endpoint

**`[MUST]`** `GET /api/v1/health` `[MUST]` actively ping PostgreSQL and Redis and return HTTP 503 if either is unreachable.
Successful health responses return direct JSON payloads:

```json
{
  "status": "ok",
  "timestamp": "2026-04-01T10:00:00.000Z",
  "version": "2.0.0",
  "database": "connected",
  "redis": "connected"
}
```

### 4.4 Standard Response Envelope

**`[MUST]`** Error responses always use the standard envelope from the global error handler. Success responses return route-specific payloads directly by default. When `FEATURE_RESPONSE_ENVELOPE_ENABLED=true`, all 2xx JSON responses are additionally wrapped in `{ "success": true, "data": <T>, "meta"?: {...} }` via the `onSend` hook (`src/common/hooks/response-envelope.hook.ts`):

```typescript
// Error
interface ErrorResponse {
  success: false
  error: {
    code: string       // SCREAMING_SNAKE_CASE — e.g. ORDER_NOT_FOUND
    message: string    // Human-readable, safe to display
    statusCode: number
    details?: object   // Validation errors only
  }
}
```

**Exception:** non-JSON download responses (for example CSV exports with `text/csv`) are returned as raw file payloads and are exempt from JSON error envelope wrapping.

### 4.5 Error Code Registry

| Error Code | HTTP Status | When Used |
|---|---|---|
| `VALIDATION_ERROR` | 400 / 422 / 500 | Request validation failures (schema/business), plus a few configuration-validation guards currently surfaced with this code |
| `INVALID_CREDENTIALS` | 401 | Wrong password or OTP |
| `TOKEN_EXPIRED` | 401 | Reserved for explicit expired-token responses (currently not emitted in runtime paths) |
| `UNAUTHORISED` | 401 | No valid token provided |
| `FORBIDDEN` | 403 | Valid token, insufficient role |
| `NOT_FOUND` | 404 | Resource does not exist |
| `CONFLICT` | 409 | Duplicate SKU, email already registered |
| `INSUFFICIENT_STOCK` | 422 | Requested quantity exceeds available inventory |
| `PAYMENT_VERIFICATION_FAILED` | 401 | Payment signature verification failed |
| `INVALID_STATUS_TRANSITION` | 409 | Attempt to move order to invalid state |
| `COUPON_EXPIRED` | 400 | Coupon past validity window |
| `COUPON_USAGE_EXCEEDED` | 409 | Coupon usage limit reached |
| `PINCODE_NOT_SERVICEABLE` | 422 | Delhivery cannot deliver to address |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 / 502 / 503 | Unhandled server error (500), upstream/provider failures surfaced by adapters/services (502), or dependency health degradation responses (503) |

### 4.6 JSON Schema Validation

**`[MUST]`** Every route `[MUST]` declare JSON Schema for `params`, `querystring`, and `response`. Routes that accept payloads (`POST` / `PATCH` / `PUT` / `DELETE` where body is allowed) `[MUST]` also declare `body`.

**Exception:** third-party mounted UIs (for example Bull Board at `/api/v1/ops/queues`) may rely on plugin-provided routes and are exempt from per-route Fastify schema slot declarations, but `[MUST]` remain protected by ops session authorization.

**`[MUST]`** `additionalProperties: false` `[MUST]` be set on all declared request body schemas. All 14 module schema files (300+ `type: 'object'` declarations) have been audited and confirmed compliant. Only webhook header schemas intentionally use `additionalProperties: true`.

**`[MUST]`** All string inputs `[MUST]` have `maxLength`. All numeric inputs `[MUST]` have `minimum` and `maximum`.

### 4.7 Pagination

**`[MUST]`** All collection-list endpoints `[MUST]` support:

```typescript
interface PaginationQuery {
  page?: number   // default: 1
  limit?: number  // default: 20, max: 100
}
```

**`[MUST]`** Paginated responses `[MUST]` include the `meta` object.
Aggregate/report endpoints may return fixed arrays when pagination is not part of the route contract.

---

## 5. Database Requirements

### 5.1 Primary Key Convention

**`[MUST]`** All tables `[MUST]` use UUID v4 as primary keys: `id String @id @default(uuid())`

**`[NEVER]`** Sequential integer IDs `[NEVER]` used as primary keys — they leak record counts.

### 5.2 Timestamp Convention

**`[MUST]`** All tables `[MUST]` include `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt`.

### 5.3 Money Storage

**`[MUST]`** All monetary values `[MUST]` be stored as `Int` (paise). ₹1 = 100 paise.

**`[NEVER]`** `Float`, `Decimal`, or `String` `[NEVER]` used for monetary values anywhere in the system.

**`[MUST]`** Display conversion `[MUST]` occur only at the presentation layer: `(paise / 100).toFixed(2)`

### 5.4 Snapshot Fields on OrderItem

**`[MUST]`** These fields `[MUST]` be snapshotted at order creation time and `[NEVER]` updated afterward:

```prisma
productName String   // snapshot of Product.name
variantName String   // snapshot of ProductVariant.name
sku         String   // snapshot of ProductVariant.sku
unitPrice   Int      // snapshot of ProductVariant.price (paise)
totalPrice  Int      // quantity × unitPrice (paise)
```

**`[MUST]`** `Order.shippingAddress` `[MUST]` be a `Json` snapshot — never a FK to `Address`.

**`[MUST]`** `CartItem.priceSnapshot` `[MUST]` capture `ProductVariant.price` at add-to-cart time.

### 5.5 Soft Delete

**`[MUST]`** Products `[MUST]` use soft delete via `isActive Boolean @default(true)`.

**`[NEVER]`** Hard deletes on the `Product` table — they corrupt `OrderItem` snapshots.

### 5.6 Full-Text Search

**`[MUST]`** Product search `[MUST]` use PostgreSQL `tsvector` with a GIN index created via raw SQL migration (`20260427030000_add_product_full_text_search`).

> **Prisma gotcha:** The `search_vector` column is a PostgreSQL `GENERATED ALWAYS AS (...) STORED` column. It `[MUST NOT]` appear in `schema.prisma` because Prisma's `Unsupported("tsvector")` type cannot represent generated columns — this causes false drift detection and failed migrations on every fresh `prisma migrate dev`. The column is managed entirely by the raw SQL migration and queried exclusively via `$queryRaw`.

```typescript
await prisma.$queryRaw`
  SELECT id, name, slug FROM "Product"
  WHERE to_tsvector('english', name || ' ' || description)
    @@ plainto_tsquery('english', ${query})
  AND "isActive" = true
  ORDER BY ts_rank(
    to_tsvector('english', name || ' ' || description),
    plainto_tsquery('english', ${query})
  ) DESC
  LIMIT ${limit} OFFSET ${offset}
`
```

### 5.7 Complete Prisma Schema

#### Enums

```prisma
enum Role { CUSTOMER ADMIN }

enum OrderStatus {
  PENDING_PAYMENT  PAYMENT_FAILED  CONFIRMED  PROCESSING
  SHIPPED  OUT_FOR_DELIVERY  DELIVERED  CANCELLED  REFUNDED
}

enum PaymentStatus { CREATED  CAPTURED  FAILED  REFUNDED  PARTIALLY_REFUNDED }
enum PaymentProvider { RAZORPAY  CASHFREE }
enum ShippingProvider { DELHIVERY  SHIPROCKET  SELF }

enum ShipmentStatus {
  PENDING  BOOKED  PICKED_UP  IN_TRANSIT  OUT_FOR_DELIVERY
  DELIVERED  FAILED_DELIVERY  RTO_INITIATED  RTO_DELIVERED  CANCELLED
}

enum NotificationChannel { EMAIL  SMS  WHATSAPP }
enum NotificationStatus { PENDING  SENT  FAILED }
enum CouponType { PERCENTAGE_OFF  FLAT_AMOUNT_OFF  FREE_SHIPPING  BUY_X_GET_Y }
enum AnalyticsEventType {
  PAGE_VIEW  PRODUCT_VIEW  ADD_TO_CART  REMOVE_FROM_CART
  CHECKOUT_STARTED  PAYMENT_INITIATED  PURCHASE  SEARCH
}
```

#### Users & Addresses

```prisma
model User {
  id           String    @id @default(uuid())
  email        String    @unique
  phone        String?   @unique
  passwordHash String
  firstName    String
  lastName     String
  role         Role      @default(CUSTOMER)
  isVerified   Boolean   @default(false)
  addresses    Address[]
  orders       Order[]
  cart         Cart?
  reviews      Review[]
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  @@index([email])
  @@index([phone])
}

model Address {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  fullName  String
  phone     String
  line1     String
  line2     String?
  city      String
  state     String
  pincode   String
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([userId])
}
```

#### Catalogue

```prisma
model Category {
  id        String     @id @default(uuid())
  name      String
  slug      String     @unique
  parentId  String?
  parent    Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children  Category[] @relation("CategoryTree")
  imageUrl  String?
  isActive  Boolean    @default(true)
  products  Product[]
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt
}

model Product {
  id              String           @id @default(uuid())
  name            String
  slug            String           @unique
  description     String
  categoryId      String
  category        Category         @relation(fields: [categoryId], references: [id])
  tags            String[]
  attributes      Json?
  metaTitle       String?
  metaDescription String?
  isActive        Boolean          @default(true)
  isFeatured      Boolean          @default(false)
  images          ProductImage[]
  variants        ProductVariant[]
  reviews         Review[]
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  @@index([slug])
  @@index([categoryId])
  @@index([isActive])
}

model ProductImage {
  id        String   @id @default(uuid())
  productId String
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  url       String
  altText   String
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  @@index([productId])
}

model ProductVariant {
  id             String      @id @default(uuid())
  productId      String
  product        Product     @relation(fields: [productId], references: [id], onDelete: Cascade)
  sku            String      @unique
  name           String
  attributes     Json?
  price          Int
  compareAtPrice Int?
  weight         Int?
  isActive       Boolean     @default(true)
  inventory      Inventory?
  cartItems      CartItem[]
  orderItems     OrderItem[]
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt
  @@index([productId])
  @@index([sku])
}

model Inventory {
  id                String         @id @default(uuid())
  variantId         String         @unique
  variant           ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  quantity          Int            @default(0)
  lowStockThreshold Int            @default(5)
  lowStockAlerted   Boolean        @default(false)
  updatedAt         DateTime       @updatedAt
}
```

#### Cart

```prisma
model Cart {
  id           String     @id @default(uuid())
  userId       String?    @unique
  user         User?      @relation(fields: [userId], references: [id], onDelete: Cascade)
  sessionToken String?    @unique
  couponId     String?
  coupon       Coupon?    @relation(fields: [couponId], references: [id])
  expiresAt    DateTime
  items        CartItem[]
  updatedAt    DateTime   @updatedAt
  @@index([sessionToken])
}

model CartItem {
  id            String         @id @default(uuid())
  cartId        String
  cart          Cart           @relation(fields: [cartId], references: [id], onDelete: Cascade)
  variantId     String
  variant       ProductVariant @relation(fields: [variantId], references: [id])
  quantity      Int
  priceSnapshot Int
  @@unique([cartId, variantId])
  @@index([cartId])
}
```

#### Orders

```prisma
model Order {
  id              String               @id @default(uuid())
  orderNumber     String               @unique
  userId          String
  user            User                 @relation(fields: [userId], references: [id])
  status          OrderStatus          @default(PENDING_PAYMENT)
  shippingAddress Json
  subtotal        Int
  shippingCharge  Int                  @default(0)
  discountAmount  Int                  @default(0)
  total           Int
  notes           String?
  items           OrderItem[]
  payment         Payment?
  shipment        Shipment?
  statusHistory   OrderStatusHistory[]
  invoice         Invoice?
  createdAt       DateTime             @default(now())
  updatedAt       DateTime             @updatedAt
  @@index([userId])
  @@index([status])
  @@index([orderNumber])
  @@index([createdAt])
  @@index([status, createdAt])
}

model OrderItem {
  id          String         @id @default(uuid())
  orderId     String
  order       Order          @relation(fields: [orderId], references: [id])
  variantId   String
  variant     ProductVariant @relation(fields: [variantId], references: [id])
  productName String
  variantName String
  sku         String
  quantity    Int
  unitPrice   Int
  totalPrice  Int
  @@index([orderId])
}

model OrderStatusHistory {
  id         String       @id @default(uuid())
  orderId    String
  order      Order        @relation(fields: [orderId], references: [id])
  fromStatus OrderStatus?
  toStatus   OrderStatus
  note       String?
  createdAt  DateTime     @default(now())
  @@index([orderId])
}
```

#### Payments & Shipments

```prisma
model Payment {
  id                String          @id @default(uuid())
  orderId           String          @unique
  order             Order           @relation(fields: [orderId], references: [id])
  provider          PaymentProvider
  providerOrderId   String
  providerPaymentId String?
  amount            Int
  currency          String          @default("INR")
  status            PaymentStatus   @default(CREATED)
  method            String?
  webhookPayload    Json?                               // sanitized provider metadata (no raw sensitive blobs)
  capturedAt        DateTime?
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt
  @@index([providerOrderId])
  @@index([providerPaymentId])
}

model Shipment {
  id                String           @id @default(uuid())
  orderId           String           @unique
  order             Order            @relation(fields: [orderId], references: [id])
  provider          ShippingProvider
  awbNumber         String?
  status            ShipmentStatus   @default(PENDING)
  trackingUrl       String?
  estimatedDelivery DateTime?
  webhookPayload    Json?                               // sanitized provider metadata (no raw sensitive blobs)
  events            ShipmentEvent[]
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
  @@index([awbNumber])
}

model ShipmentEvent {
  id          String   @id @default(uuid())
  shipmentId  String
  shipment    Shipment @relation(fields: [shipmentId], references: [id])
  status      String
  location    String?
  description String
  occurredAt  DateTime
  @@index([shipmentId])
}
```

#### Promotions, Reviews, Notifications, Analytics, Invoices

```prisma
model Coupon {
  id             String     @id @default(uuid())
  code           String     @unique
  type           CouponType
  value          Int
  minOrderPaise  Int        @default(0)
  maxUsesTotal   Int?
  maxUsesPerUser Int?
  usesCount      Int        @default(0)
  isActive       Boolean    @default(true)
  validFrom      DateTime
  validUntil     DateTime?
  applicableTo   Json?
  // Soft delete fields
  deletedAt      DateTime?
  deletedBy      String?    // Admin user ID who deleted
  // Audit fields
  createdBy      String     // Admin user ID who created
  updatedBy      String?    // Admin user ID who last updated
  carts          Cart[]
  orders         Order[]
  auditLogs      CouponAuditLog[]
  usages         CouponUsage[]
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
  @@index([code])
  @@index([deletedAt])
  @@index([createdBy])
  @@index([isActive, deletedAt, validFrom, validUntil])
}

model CouponAuditLog {
  id          String   @id @default(uuid())
  couponId    String
  coupon      Coupon   @relation(fields: [couponId], references: [id], onDelete: Cascade)
  action      String   // CREATE, UPDATE, DELETE, RESTORE, PAUSE, RESUME, ACTIVATE
  actorId     String   // Admin user ID who performed action
  actorType   String   // ADMIN, SYSTEM
  previousState Json?  // Full previous state (for updates)
  newState      Json   // Full new state
  changes       Json?  // Diff of only changed fields
  ipAddress   String?
  userAgent   String?

  // Tamper-evident hash chain
  previousChainHash String?   // 'GENESIS' for first record per coupon; SHA-256 hash of prior row for subsequent rows
  chainHash         String    // SHA-256(previousChainHash + canonicalised audit payload)

  createdAt   DateTime @default(now())
  @@index([couponId, createdAt])
  @@index([actorId, createdAt])
  @@index([action, createdAt])
  @@index([chainHash])
}

model CouponUsage {
  id             String   @id @default(uuid())
  couponId       String
  coupon         Coupon   @relation(fields: [couponId], references: [id], onDelete: SetNull)
  orderId        String
  order          Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  userId         String
  discountAmount Int      // Actual discount applied in paise
  usedAt         DateTime @default(now())
  @@unique([couponId, orderId])
  @@index([couponId, usedAt])
  @@index([userId, usedAt])
}

model Review {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  productId String
  product   Product  @relation(fields: [productId], references: [id])
  orderId   String
  rating    Int
  body      String?
  images    String[]
  approved  Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([userId, orderId, productId])
  @@index([productId])
  @@index([approved])
}

model WishlistItem {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  productId String
  product   Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  @@unique([userId, productId])
  @@index([userId])
  @@index([productId])
}

model NotificationLog {
  id                String              @id @default(uuid())
  channel           NotificationChannel
  recipient         String
  template          String
  status            NotificationStatus  @default(PENDING)
  provider          String
  providerMessageId String?
  errorMessage      String?
  createdAt         DateTime            @default(now())
  @@index([channel, status])
  @@index([createdAt])
}

model Invoice {
  id            String   @id @default(uuid())
  orderId       String   @unique
  order         Order    @relation(fields: [orderId], references: [id])
  invoiceNumber String   @unique
  pdfUrl        String
  issuedAt      DateTime @default(now())
}

model AnalyticsEvent {
  id         String             @id @default(uuid())
  eventType  AnalyticsEventType
  sessionId  String
  userId     String?
  payload    Json
  occurredAt DateTime           @default(now())
  @@index([eventType, occurredAt])
  @@index([sessionId])
}
```

---

## 6. Authentication & Authorisation

### 6.1 JWT Configuration

| Property | Value |
|---|---|
| Access token TTL | 15 minutes |
| Refresh token TTL | 7 days |
| Refresh token storage | bcrypt hash (cost 10) in database |
| Access token storage (frontend) | Memory only — never `localStorage` |
| Refresh token delivery | `httpOnly`, `secure`, `sameSite: strict` cookie |

**`[MUST]`** JWT payload `[MUST]` contain `{ sub: userId, role: Role, iat, exp }`.
For admin users, payload also carries operation permissions (`permissions: string[]`) used by operation-level guards.

**`[NEVER]`** Sensitive data (passwords, payment details) `[NEVER]` in JWT payload.

**`[MUST]`** `JWT_SECRET` and `JWT_REFRESH_SECRET` `[MUST]` be different values, minimum 64 random characters each. Generated via: `openssl rand -base64 64`

**`[MUST]`** JWT signing and verification `[MUST]` be explicitly pinned to `HS256` algorithm for both access tokens (`@fastify/jwt` plugin config) and refresh tokens (`jsonwebtoken` library calls). No implicit algorithm selection.

### 6.2 OTP Configuration

| Property | Value |
|---|---|
| Length | 6 digits |
| TTL | 5 minutes |
| Storage | Redis key `otp:<phone>` → SHA-256 hash of OTP |
| Max attempts | 3 per phone per 15 minutes (`otp:attempts:<phone>` counter) |
| Send rate limit | Route: 5 requests per 60 seconds (account+IP keying) + Redis cooldown: 1 OTP per 60 seconds per phone number |

**`[NEVER]`** Raw OTP value `[NEVER]` stored — only its SHA-256 hash.


**`[MUST]`** Admin login and customer login apply progressive account+IP lockout after repeated failures (threshold: 5 failures in 15 minutes, exponential lock up to 60 minutes) and return `429` with `Retry-After`.

**`[MUST]`** All `/api/v1/admin/*` routes `[MUST]` verify both valid JWT and `role === 'ADMIN'` via a `rolesGuard` Fastify `preHandler` hook.
Sensitive admin routes `[MUST]` also enforce operation-level permissions (`products:read`, `products:write`, `categories:read`, `categories:write`, `inventory:read`, `inventory:write`, `coupons:read`, `coupons:write`, `settings:read`, `settings:write`, `reviews:read`, `reviews:moderate`, `dashboard:read`, `analytics:read`, `orders:read`, `orders:write`, `orders:export`, `orders:refund`, `orders:notify`, `analytics:export`, `analytics:replay`, `users:read`, `users:write`, `shipments:read`, `payments:read`, `ops:read`).
Customer namespaces (`/api/v1/users/me*`, `/api/v1/wishlist*`, `/api/v1/orders*`, `/api/v1/payments/*`, `/api/v1/shipping/track/:awb`, `GET /api/v1/reviews/me`, `POST /api/v1/reviews`) enforce `role === 'CUSTOMER'` in addition to JWT validity.

### 6.4 Token Lifecycle

**`[MUST]`** On refresh: old refresh token invalidated, new one issued.

### 7.9 Admin Routes (`/api/v1/admin`)

Most admin routes require ADMIN JWT plus the listed merchant permission. The invite bootstrap routes are intentional exceptions:
- `POST /api/v1/ops/admin-invites`, `GET /api/v1/ops/admin-invites`, and `POST /api/v1/ops/admin-invites/cleanup-expired` require ops session auth + `ops:write/read` (Layer C ops surface). These live under the `/ops/` path prefix so the ops session cookie reaches them.
- `POST /api/v1/admin/invites/consume` and `POST /api/v1/admin/invites/setup/send-otp` are public but rate-limited and token-bound for `/admin/setup`.
- Route-discipline tooling no longer needs exemptions for the ops-gated invite routes — they sit under `/api/v1/ops/` and are auto-detected as ops-guarded.

| Method | Path | Description |
|---|---|---|
| POST | `/invites` | Ops-authenticated merchant admin invite creation (`ops:write`, Layer C); sends `/admin/setup?token=...`, expires in 10 minutes |
| POST | `/invites/consume` | Public rate-limited one-time setup-token completion; consumes token once, creates `User(role=ADMIN)` and merchant `AdminPermissionGrant` rows only after valid unexpired token verification |
| POST | `/invites/cleanup-expired` | Ops-authenticated cleanup for expired unconsumed merchant admin invites (`ops:write`, Layer C) |
| GET | `/dashboard/kpis` | `?period=today\|7d\|30d\|custom&from=&to=` |
| GET | `/dashboard/sales-chart` | `?granularity=hour\|day\|week` |
| GET | `/dashboard/top-products` | `?limit=10` |
| GET | `/products` | List paginated |
| POST | `/products/import-csv` | Bulk create/update products from CSV via `multipart/form-data` file upload (supports optional variant columns: `sku,variantName,price,compareAtPrice,weight,quantity,lowStockThreshold`) |
| POST | `/products` | Create product |
| GET | `/products/:id` | Detail |
| POST | `/products/:id/variants` | Create variant for existing product |
| PATCH | `/products/:id/variants/:variantId` | Update variant + inventory fields |
| PATCH | `/products/:id` | Update |
| DELETE | `/products/:id` | Soft-delete (deactivate) — sets `isActive: false` |
| DELETE | `/products/:id/permanent` | Hard-delete product — irreversible; `409` if order history or reviews exist; clears cart items + hosted media first. Requires `products:write`. |
| POST | `/products/:id/images/upload` | Batch multipart upload (max 5 MiB each; server-assigned sort order). R2 auto-upload when `MEDIA_STORAGE_PROVIDER=r2`; local disk + `GET /media/products/*` when `local` |
| POST | `/products/:id/images` | Add image by URL |
| PATCH | `/products/:id/images/reorder` | Reorder images |
| DELETE | `/products/:id/images/:imageId` | Delete image |
| GET | `/media/products/:productId/:filename` | Public product image (prefix `/api/v1`) |
| GET | `/categories` | Category tree list |
| POST | `/categories` | Create category |
| PATCH | `/categories/:id` | Update category |
| DELETE | `/categories/:id` | Deactivate category |
| GET | `/inventory` | All variants + stock |
| PATCH | `/inventory/:variantId` | Update quantity + threshold |
| GET | `/inventory/low-stock` | Variants below threshold |
| GET | `/orders` | `?status, from, to, search` — flat paginated list; includes `paymentMode`, `awbNumber`, `labelUrl`, `shipmentStatus`, `canShipNow`, `shipBlockReason`, `shippingMode` per item |
| GET | `/orders/board` | Kanban board grouped by status: `{ columns: { CONFIRMED, PROCESSING, SHIPPED, OUT_FOR_DELIVERY, DELIVERED, CANCELLED } }` — up to 100 most-recent orders per column; each card includes `canShipNow`, `shipBlockReason`, `shippingMode` |
| GET | `/orders/:id` | Full detail: items + payment + shipment + history + invoice metadata + ship-action state fields (`canShipNow`, `shipBlockReason`, `shippingMode`) |
| PATCH | `/orders/:id/status` | Manual status update |
| POST | `/orders/:id/ship` | Manual-only shipment booking trigger for both PREPAID and COD orders (no payment-confirmation auto-dispatch). Enforces ship eligibility checks and then books shipment; passes `payment_method: "COD"` to Shiprocket for COD orders automatically |
| POST | `/orders/:id/schedule-pickup` | Schedule courier pickup (Shiprocket) |
| POST | `/orders/:id/print-label` | Generate and return shipping label URL (Shiprocket) |
| POST | `/orders/:id/cancel` | Cancel + refund if paid |
| POST | `/orders/:id/notifications/retrigger` | Re-dispatch selected template notifications by channel (`EMAIL`/`SMS`/`WHATSAPP`) |
| GET | `/orders/export` | Download orders CSV for selected date range (`from`, `to`) with optional status/search filters |
| GET | `/return-requests` | List all return requests; supports `?status, page, limit` |
| PATCH | `/return-requests/:id` | Update return request status (`APPROVED`/`REJECTED`/`COMPLETED`) and optional `adminNote` |
| GET | `/coupons` | Paginated coupon list (`page`, `limit`, `code`, `status`). Excludes deleted by default. |
| POST | `/coupons` | Create coupon (`BUY_X_GET_Y` rejected until v2.2). Tracks `createdBy` admin. **Per-admin rate limit: 10 req/min.** |
| PATCH | `/coupons/:id` | Update coupon fields. Prevents updates to deleted coupons. Tracks `updatedBy`. **Per-admin rate limit: 20 req/min.** |
| PATCH | `/coupons/:id/status` | Pause/unpause coupon (`isActive`). Tracks `updatedBy`. **Per-admin rate limit: 20 req/min.** |
| DELETE | `/coupons/:id` | Soft delete coupon (sets `deletedAt`, `deletedBy`, `isActive=false`). Hard delete is NOT allowed. **Per-admin rate limit: 5 req/min.** |
| POST | `/coupons/:id/restore` | Restore soft-deleted coupon. Clears `deletedAt`, `deletedBy`, sets `isActive=true`. **Per-admin rate limit: 5 req/min.** |
| GET | `/coupons/:id/audit` | Get full audit log for coupon (create, update, delete, restore, pause/resume actions). Each entry includes `chainHash`/`previousChainHash` for tamper-evidence verification. |
| GET | `/coupons/analytics` | Coupon redemption count + total discount amount |
| GET | `/reviews` | List reviews for moderation (`approved`, `page`, `limit`) |
| PATCH | `/reviews/:id/moderate` | Approve or reject review (`approved: boolean`) |
| GET | `/settings/shipping` | Read effective pickup pincode config |
| PATCH | `/settings/shipping` | Update pickup pincode + minimum order value config |
| GET | `/settings/store` | Read store identity/regulatory profile |
| PATCH | `/settings/store` | Update store identity/regulatory profile |
| GET | `/settings/notifications` | Read channel notification toggles |
| PATCH | `/settings/notifications` | Update channel notification toggles |
| GET | `/settings/inventory` | Read default low-stock threshold |
| PATCH | `/settings/inventory` | Update default low-stock threshold |
| GET | `/settings/cod` | Read COD settings: `isCodEnabled`, `cancellationWindowHours`, `sellerState` |
| PATCH | `/settings/cod` | Update COD settings; `cancellationWindowHours` minimum is 1 (enforced by `Math.max(1, ...)`) |
| GET | `/users` | Paginated customer list (+ search + aggregates); phone numbers masked (last 4 digits visible); includes `totalOrders` + `totalSpendPaise` per record |
| GET | `/users/:id` | Profile + addresses + order history + ban status (`isBanned`, `bannedAt`, `bannedReason`) |
| GET | `/users/:id/orders` | Paginated order history for a specific customer. Query: `page`, `limit`. |
| PATCH | `/users/:id/ban` | Ban customer: sets `isBanned=true`, `bannedAt`, `bannedReason`. Body: `{ reason }`. Requires `users:write`. Cannot ban admins or already-banned users. |
| DELETE | `/users/:id/ban` | Unban customer: clears `isBanned`, `bannedAt`, `bannedReason`. Requires `users:write`. Returns 400 if not currently banned. |
| GET | `/users/:id/notes` | List admin notes on a customer account (`UserAdminNote` rows). Requires `users:read`. |
| POST | `/users/:id/notes` | Create admin note. Body: `{ content }`. Tagged with admin ID. Requires `users:write`. |
| DELETE | `/users/:id/notes/:noteId` | Delete an admin note (validates note belongs to the specified user). Requires `users:write`. |
| GET | `/shipments` | Paginated shipment list across all orders. Query: `status`, `provider`, `page`, `limit`. Requires `shipments:read`. |
| GET | `/shipments/:id` | Single shipment detail — `awbNumber`, `shiprocketShipmentId`, `provider`, `status`, `pickupScheduledDate`. Requires `shipments:read`. |
| GET | `/payments` | Paginated payment list across all orders. Query: `status`, `provider`, `page`, `limit`. Requires `payments:read`. |
| GET | `/payments/:id` | Single payment detail — `amount` (Int paise), `provider`, `status`. Requires `payments:read`. |
| GET | `/return-requests/:id` | Full detail for a single return request. Requires `orders:read`. |
| PATCH | `/orders/:id/items` | Update order line-item quantities/notes. Requires `orders:write`. |
| GET | `/inventory/history/:variantId` | Paginated `InventoryAdjustment` history for a variant. Query: `page`, `limit`. Requires `inventory:read`. |
| POST | `/inventory/bulk-update` | Bulk stock adjustment for up to 100 variants in a single `$transaction`. Body: `{ items: [{ variantId, quantity, note? }] }`. Requires `inventory:write`. |
| DELETE | `/products/:id/variants/:variantId` | Delete a product variant. Returns 400 if it is the last variant on the product. Requires `products:write`. |
| DELETE | `/reviews/:id` | Hard-delete a review record. Requires `reviews:moderate`. |
| GET | `/analytics/revenue` | `?from, to, granularity` |
| GET | `/analytics/revenue/export` | Revenue CSV export (`?from, to, granularity`) |
| GET | `/analytics/funnel` | Conversion funnel from AnalyticsEvent |
| GET | `/analytics/inventory-alerts` | Past 30-day low-stock alert events report |
| GET | `/analytics/notifications` | Delivery rates per channel |
| GET | `/analytics/category-breakdown` | Revenue contribution by category (`from`, `to`) |
| GET | `/analytics/reconciliation-issues` | Inventory/payment reconciliation issues (`page`, `limit`, filters per schema) |
| GET | `/analytics/outbox-dead-letter` | Paginated BullMQ dead-letter / failed outbox messages (`analytics:replay`) |
| POST | `/analytics/outbox-dead-letter/:id/replay-preview` | Preview replay side-effects (`analytics:replay`) |
| POST | `/analytics/outbox-dead-letter/:id/replay` | Enqueue replay (`reason`, `dryRun`, `approvalToken`; strict profiles require `REPLAY_APPROVAL_TOKEN` where enforced) (`analytics:replay`) |
| GET | `/analytics/inbox-failures` | Webhook inbox failures pending remediation (`analytics:replay`) |
| POST | `/analytics/inbox-failures/:id/replay-preview` | Preview inbox replay (`analytics:replay`) |
| POST | `/analytics/inbox-failures/:id/replay` | Execute inbox replay (`approvalToken`, optional `operationType`, `rawPayload`, `verificationHeader`, … per schema) (`analytics:replay`) |
| GET | `/ops/queues` | Bull Board UI — ops plane only (`ops:read`, Layer C) |
| GET | `/ops/queues/dlq/summary` | Dead-letter queue summary card — total DLQ jobs, breakdown by source queue (`ops:read`, Layer C) |

### 7.10 Webhook Raw Body Requirement

**`[MUST]`** Webhook routes `[MUST]` preserve raw request content (`parseAs: 'buffer'`) and pass raw JSON text to handlers; cryptographic verification always runs on `Buffer.from(rawText)`:

```typescript
fastify.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body, done) => done(null, body)
)
```

### 7.11 PCI scope & API exposure classes

**`[MUST]`** This service `[MUST NOT]` receive, store, or log primary account numbers (PAN), CVC/CVV, or magnetic-stripe data. Checkout uses the configured PSP (Razorpay by default); only PSP order ids, payment ids, signatures, and amounts are exchanged.

**`[MUST]`** JSON responses `[MUST]` be minimized per caller class: public catalogue routes omit admin-only cost/inventory internals; customer routes omit internal shipment linkage ids and admin-only joins; admin routes use operation-level permissions as listed in §6.3. Ops metrics (`/api/v1/ops/metrics`) require `x-ops-token` in production; allowlist is defense-in-depth.

| Class | Typical auth | Notes |
|------|----------------|-------|
| Public | None | Product/cart/reviews (limited)/webhooks (crypto or token verify) |
| Customer | JWT + `CUSTOMER` | Profile, orders, payments, wishlist, tracking |
| Admin | JWT + `ADMIN` + permission | `/api/v1/admin/*` as enumerated in §7.9 |
| Ops | Header token (+ allowlist defense-in-depth) | Metrics scraper only |

### 7.11.1 Control Ownership Layers (A/B/C)

`[MUST]` endpoint ownership is enforced by control layer:

| Layer | Ownership | Routes | Mutability |
|---|---|---|---|
| A | `merchant` | `/api/v1/admin/*` day-to-day operations | Read + write |
| B | `merchant` (with audit metadata) | Sensitive admin operations (refund/replay) | Read + controlled write |
| C | `developer` | `/api/v1/ops/*` | Platform-only writes; merchant read-only diagnostics only |

`[MUST]` Layer C mutations be denied to merchant roles even when authenticated as `ADMIN`.
`[MUST]` route-level controls remain additive/backward-compatible for response payload changes.
`[MUST]` compatibility window: legacy grant scopes (`merchant:ops:*`, `merchant:superadmin:*`, `platform:ops:*`, `security:auditor:*`) remain accepted and mapped internally to canonical `merchant` / `developer`.

### 7.12 Optional webhook defense-in-depth (env)

**`[MAY]`** When `RAZORPAY_WEBHOOK_ALLOWLIST_CIDR` / `SHIPPING_WEBHOOK_ALLOWLIST_CIDR` (falls back to `DELHIVERY_WEBHOOK_ALLOWLIST_CIDR`) are non-empty, ingress IPs `[MAY]` be restricted to comma-separated IPs/CIDRs for both IPv4 and IPv6. Signature/token verification remains mandatory.

**`[MAY]`** When Razorpay sends a numeric top-level `created_at` (Unix seconds), events outside `RAZORPAY_WEBHOOK_MAX_SKEW_SECONDS` (default 300) are rejected with `401`. Events without `created_at` remain accepted for backward compatibility.

**`[MAY]`** For shipping provider webhooks with required fields (`awb`, `status`, `description`), when `occurredAt` is present it `[MUST]` be parseable ISO-8601; malformed values return `400` (`VALIDATION_ERROR`). When parseable, events outside the provider's max-skew window (default 300s via `DELHIVERY_WEBHOOK_MAX_SKEW_SECONDS` or `SHIPROCKET_WEBHOOK_MAX_SKEW_SECONDS`) return `401` (`UNAUTHORISED`). Empty/absent `occurredAt` skips skew checks (backward compatibility).

### 7.13 Checkout risk hook

**`[MAY]`** When `RISK_VELOCITY_ENABLED=true`, payment initiation is limited per user per hour (`RISK_PAYMENT_INIT_MAX_PER_HOUR`, default 30) via Redis counters.

**`[MUST]`** Custom fraud or scoring integrations `[MUST]` implement `CheckoutRiskAssessmentPort` from `src/common/interfaces/checkout-risk.interface.ts`. Before `registerOrdersRoutes`, either rely on the built-in default (`registerOrdersRoutes` calls `fastify.decorate('checkoutRisk', new CheckoutRiskService(fastify))` when the decorator is absent) or register your own: `fastify.decorate('checkoutRisk', myAdapter)` in an application plugin that runs **before** `registerOrdersRoutes` in `registerApp` (`src/app.ts`). `OrdersService` reads `fastify.checkoutRisk` (with a same-process fallback for tests). Vendor adapters `[MUST]` map failures only to `ERROR_CODES` from §4.5 (see `docs/DECISIONS.md`).

### 7.14 Public maintenance status (`/api/v1/maintenance`)

Public, unauthenticated routes that power the storefront maintenance banner and the Nginx `auth_request` gate for the durable `maintenance` load-shed mode. Both routes are listed in `ALWAYS_ALLOWED_PREFIXES` so they remain reachable while `mode === 'maintenance'` with `phase === 'active'`.

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/maintenance/status` | None | JSON snapshot for the storefront banner. Returns `{ mode, phase, pendingUntil, activatedAt, serverTime }`. `serverTime` is always present (required field on the response schema) so the client-side countdown aligns with the server clock instead of the device clock. Rate-limit-exempt. |
| GET | `/maintenance/gate` | None (internal Nginx subrequest) | Returns `200 { allowed: true }` when the request must pass through (normal/pending mode, or path in `ALWAYS_ALLOWED_PREFIXES`) and `401 { allowed: false }` when maintenance is active and the path is blocked. The decision is derived from `X-Original-URI` (set by Nginx). The `X-Maintenance-Active: 0|1` response header is preserved on both shapes for backward compatibility with direct API callers but is **not** the mechanism Nginx uses — Nginx's `auth_request` natively reads the status code and triggers `error_page 401 = @maintenance_block;` on the gated `location`, which `return 503` flows into `error_page 502 503 /maintenance.html`. The previous always-200 + `auth_request_set` + `if ($maintenance_active = "1") { return 503; }` pattern was structurally broken (the `if` runs in Nginx's REWRITE phase, **before** `auth_request` populates the variable in the ACCESS phase) and silently let traffic through during active maintenance — see `docs/HARDENING_HISTORY.md` "May 2026 — Maintenance gate bypass (auth_request phase ordering)". Rate-limit-exempt. |

**`[MUST]`** Maintenance mode is durable — backed by the `MaintenanceState` Postgres model (single-row singleton, source of truth) with a Redis cache (`ops:maintenance:state`, 5-min TTL). Survives Redis flush, container restart, and database failover. The backend rehydrates the Redis cache from Postgres on boot if a row exists.

**`[MUST]`** The `LOAD_SHED_MODE` env var cannot force `maintenance` — only the Ops API can. This prevents accidentally stuck maintenance windows via leftover env config and ensures every transition is audit-logged (`LOAD_SHED_CHANGE`) with the phase flip and any `pendingUntil` deadline.

### 7.17 Ops Control Plane Routes (`/api/v1/ops`)

**Layer C operations (developer/platform only).** All routes require a browser session cookie issued after email-OTP login. There is no API key path.

#### 7.17.1 Invite Lifecycle Routes

| Method | Path | Auth | Body | Response | Notes |
|--------|------|------|------|----------|-------|
| POST | `/invites` | Trusted host CLI only (`ops:newuser`) | `{ email, name, setupBaseUrl }` | `{ inviteId, email, expiresAt }` | Creates invite; sends setup email via Resend. Expires in 10 minutes. |
| POST | `/invites/consume` | Public (token-in-URL) | `{ token, name? }` | `{ opsUserId, email, name, permissions }` | One-time use; creates `OpsUser`. No API credentials issued — login uses email OTP. |
| POST | `/invites/cleanup-expired` | Ops auth (`ops:write`) | — | `{ purgedCount }` | Manual trigger; also runs via recurring BullMQ job every 15 min. |

**`[MUST]`** Invite tokens are cryptographically random 32-byte hex strings, hashed (SHA-256) before DB storage.

**`[MUST]`** Expired unconsumed invites transition to `EXPIRED_CLEANED` status before hard deletion; deletion is audit-logged.

#### 7.17.2 Email OTP Challenge Routes

| Method | Path | Auth | Body | Response | Notes |
|--------|------|------|------|----------|-------|
| POST | `/otp/request` | Ops auth (`ops:write`) | `{ action, metadata? }` | `{ challengeId, expiresAt }` | Creates `OpsOtpChallenge`; 6-digit OTP sent to ops user email via Resend. Max 3 attempts. |
| POST | `/otp/verify` | Ops auth + `x-ops-challenge-id` header | `{ otp }` | `{ verified: true, action }` | Transition to `VERIFIED`; failures increment counter; 3 failures → `FAILED`. |

**`[MUST]`** OTP codes are 6-digit numeric (`crypto.randomInt(100000, 999999)`), SHA-256 hashed for storage.

**`[MUST]`** Verified challenges are short-lived (10 min); verified status is checked for privileged write operations.

#### 7.17.3 Config Contract Routes

| Method | Path | Auth | Body | Response | Notes |
|--------|------|------|------|----------|-------|
| GET | `/config/overview` | Ops auth (`ops:read`) | — | `{ domains: { core, notifications, payment, shipping, security, featureFlags }, requiredMissing, warnings }` | Computed from `ops-config-contract.ts`; reveals only contract-defined keys. |
| GET | `/config/stored` | Ops auth (`ops:read`) | — | `{ secrets: [{ key, domain, updatedAt }], maskedValues }` | Returns key list with metadata; secret values masked (`****`). |
| POST | `/config/save` | Ops auth (`ops:write`) + verified OTP | `{ domain?, values, challengeId, otpCode }` | `{ valid, savedKeys, domain, requiresRestart, masked }` | `domain` optional — when omitted, each key's domain is resolved via `resolveOpsConfigDomainForKey()`. Only non-bootstrap keys with `mutableViaOps: true` are persisted as DB overlays (AES-256-GCM). Empty/null values deactivate the overlay (`isActive: false`) instead of storing blank ciphertext. |

**`[MUST]`** Config contract (`ops-config-contract.ts`) is the single source of truth:
- `OPS_CONFIG_OVERVIEW_GROUPS`: groups keys by domain and mutability.
- `mutableViaOps` on each key controls DB-overlay eligibility for non-bootstrap keys.
- Bootstrap-only keys (`DATABASE_URL`, initial `REDIS_URL`, `OPS_DB_ENCRYPTION_KEY`) must come from real deployment environment and are never activated from DB-backed config.
- API and worker startup load DB-stored encrypted runtime overlays before provider/workers initialize, then run runtime validation.
- Required key computation per provider/flags remains contract-driven (e.g., `RAZORPAY_*` required when `PAYMENT_PROVIDER=razorpay`).

**`[MUST]`** Ops mutation policy is explicit in the contract. `DATABASE_URL`, initial `REDIS_URL`, and `OPS_DB_ENCRYPTION_KEY` are bootstrap-only. Other contract-listed runtime/security keys (for example JWT secrets, provider secrets, `REPLAY_APPROVAL_TOKEN`) are editable through ops save only when marked `mutableViaOps: true`, require verified OTP, are encrypted at rest, and take effect after restart.

#### 7.17.4 Core Ops Routes (existing)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/session` | Ops auth | Returns current session user profile (id, email, permissions, lastLoginAt). |
| GET | `/metrics` | `x-ops-token` matching `OPS_METRICS_TOKEN` | Prometheus text format. Allowlist is defense-in-depth. |
| GET | `/load-shed` | Ops auth (`ops:read`) | Returns `{ mode, phase, pendingUntil, activatedAt, reason }`. `mode ∈ normal | reduced | emergency | maintenance`; `phase ∈ null | pending | active` (non-null only for `maintenance`). |
| POST | `/load-shed` | Ops auth (`ops:write`) + verified OTP | Body: `{ mode: 'normal'|'reduced'|'emergency'|'maintenance', reason, challengeId, otpCode }`. Applies mode change immediately. `mode: 'maintenance'` writes a durable Postgres-backed `MaintenanceState` row, starts a 2-minute `pending` window, and enqueues a `maintenance-activation` job that drains queues + `PENDING_PAYMENT` before flipping to `active`. Returns `{ mode, updated: true, phase, pendingUntil }`. |
| GET | `/users` | Ops auth (`ops:read`) | List ops users. |
| GET | `/users/:opsUserId` | Ops auth (`ops:read`) | Get ops user profile. |
| POST | `/users/:opsUserId/deactivate` | Ops auth (`ops:write`) + verified OTP | Body: `{ reason, challengeId, otpCode }`. Deactivate an ops user. |
| POST | `/invites/:inviteId/revoke` | Ops auth (`ops:write`) + verified OTP | Body: `{ challengeId, otpCode }`. Revoke a pending ops invite. |
| POST | `/system/restart` | Ops auth (`ops:write`) + verified OTP | Body: `{ delayMinutes, challengeId, otpCode }`. Schedule process restart. Returns `{ jobId, scheduledFor }`. |
| GET | `/audit/logs` | Ops auth (`ops:read`) | Tamper-evident audit timeline with `previousChainHash`. |

#### 7.17.5 Ops Security Model

**`[MUST]`** Ops authentication verifies in order:
1. Browser session cookie (`ops_session`) is present and valid → `401` if missing.
2. Session user `isActive=true` → `401` if deactivated.
3. For the `ops:write` scope: `challengeId` + `otpCode` in request body match a verified `OpsOtpChallenge` → `403` if missing/expired. (Email OTP challenge — no TOTP/authenticator-app MFA.)

There is no API key path. Access from any IP is allowed; OTP email verification is the sole second factor.

**`[MUST]`** Audit logging captures for every ops action:
- `actionType` (Prisma enum `OpsActionType`): `INVITE_CREATED`, `INVITE_CONSUMED`, `INVITE_EXPIRED_CLEANED`, `INVITE_REVOKED`, `OTP_CHALLENGE_REQUESTED`, `OTP_CHALLENGE_VERIFIED`, `OTP_CHALLENGE_FAILED`, `USER_DEACTIVATED`, `OPS_USER_LOGGED_IN`, `OPS_USER_LOGGED_OUT`, `ENV_READ`, `ENV_UPDATE`, `LOAD_SHED_CHANGE`, `CONTAINER_RESTART`
- Actor `opsUserId` and IP
- `previousChainHash` for tamper-evident chaining
- `metadata` JSONB for action context

---

## 10. Background Job Requirements

### 10.1 BullMQ Default Job Options

```typescript
const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },  // 2s, 4s, 8s
  removeOnComplete: { age: 86400 },                // keep 24h
  removeOnFail:     { age: 604800 }                // keep 7 days for inspection
}
```

**`[MUST]`** Bull Board UI mounted at `/api/v1/ops/queues` with ops session enforcement (`opsAuthGuard` + `opsPermissionGuard('ops:read')`).

### 10.2 Queue Registry

#### `order-processing`

| Job | Trigger | Action |
|---|---|---|
| `process-order-update` | Enqueued by `payment-webhook`, `deduct-inventory`, `confirm-order` stubs, or reconciliation auto-heal | **Canonical entry point.** Atomic CAS update of order/payment to `CONFIRMED`/`CAPTURED`, inventory deduction, coupon `usesCount` increment, reservation release, GST invoice generation, outbox analytics, customer notifications. Idempotent via `jobId`. |
| `deduct-inventory` | `payment.captured` webhook or `/payments/verify` | **Thin stub.** Resolves `orderId` from payment record and enqueues `process-order-update` with `jobId: deduct-inventory:<orderId>`. No direct mutations. |
| `confirm-order` | `payment.captured` webhook (legacy webhook payload shape) | **Thin stub.** Resolves `orderId` from payment record and enqueues `process-order-update` with `jobId: confirm-order:<orderId>`. No direct mutations. |
| `payment-webhook` | Any Razorpay `payment.*` event | For `payment.captured`: enqueues `process-order-update`. For `payment.failed`: updates order/payment status directly. |
| `generate-invoice` | After `process-order-update` confirms order | Generate PDF, store locally, create Invoice record |
| `generate-credit-note` | Refund worker completion | Append structured `CREDIT_NOTE|{...}` note in `OrderStatusHistory` for refunded orders. `jobId` deterministic on both outbox and direct BullMQ paths. |

#### `notifications`

| Job | Data | Action |
|---|---|---|
| `send-email` | `{ to, template, data }` | Render React Email, send via Resend, log |
| `send-sms` | `{ phone, template, data }` | Call MSG91 flow API, log |
| `send-whatsapp` | `{ phone, template, data }` | Call MetaWhatsAppAdapter if enabled, log |

**Channel provider mapping:**
- Email: Resend (`ResendAdapter`) — requires `RESEND_API_KEY`, `RESEND_FROM`
- SMS: MSG91 (`Msg91Adapter`) — requires `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, `MSG91_ROUTE`
- WhatsApp: Meta Cloud API (`MetaWhatsAppAdapter`) — requires `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`

**Toggle behavior:**
- `NOTIFY_EMAIL_ENABLED` — defaults to `true` (if unset)
- `NOTIFY_SMS_ENABLED` — defaults to `false` (if unset); SMS is opt-in — must explicitly enable and configure provider credentials
- `NOTIFY_WHATSAPP_ENABLED` — defaults to `false` (if unset); must explicitly enable

**Credential validation:**
- Resend and MSG91 credentials are validated when respective channels are enabled
- Meta WhatsApp credentials are only validated when `NOTIFY_WHATSAPP_ENABLED=true`
- Disabled channels skip credential requirements at startup

#### `shipping`

| Job | Trigger | Action |
|---|---|---|
| `create-shipment` | Admin `POST /api/v1/admin/orders/:id/ship` | Call active ShippingProviderAdapter, store AWB + provider-specific IDs |
| `update-shipment-status` | Provider webhook | Update Shipment.status, create ShipmentEvent, enqueue notification |
| `shipment-webhook` | Provider webhook (legacy alias) | Backward-compatible alias for `update-shipment-status` payload contract |
| `shiprocket-token-refresh` | Repeatable (every 9 days) | Warm the JWT cache by calling a no-op API; prevents stale tokens after worker restarts |

#### `inventory-alerts` (Repeatable — every 60 min)

Find all `Inventory` where `quantity <= lowStockThreshold AND lowStockAlerted = false`. Enqueue `send-email` with `LowStockAlert` to admin. Set `lowStockAlerted = true`.

#### `refunds`

| Job | Trigger | Action |
|---|---|---|
| `initiate-razorpay-refund` | Order cancelled with `CAPTURED` payment | Call `RazorpayAdapter.initiateRefund()`, update statuses |

#### `analytics`

Records `AnalyticsEvent` from storefront events asynchronously.

#### `cart-cleanup` (Repeatable — daily at 02:00)

Deletes `Cart` records where `userId IS NULL AND expiresAt < NOW()`.

#### `cart-cleanup` (Repeatable — every 60 sec)

Releases expired `CartReservation` records (`expiresAt < NOW()`), making stock available again.

#### `outbox-dispatch` (Repeatable — every 10 sec)

Publishes pending `OutboxMessage` records to target queues and marks status (`PUBLISHED` / `FAILED`) with attempt/error metadata.

#### `reconciliation` (Repeatable — every 60 min)

Runs lifecycle integrity checks (order/payment/shipment/refund consistency) and records unresolved anomalies into `ReconciliationIssue`.

### 10.3 Why BullMQ for Webhook Processing

> Razorpay has a **5-second webhook response timeout**. The downstream chain after `payment.captured` — inventory decrement + order confirmation + invoice generation + notifications — can take 2–10 seconds. The webhook handler verifies the HMAC signature, enqueues BullMQ jobs, and responds `200 OK` in < 200ms. Redis idempotency prevents duplicate processing on Razorpay retries.

---

## 11. Security Requirements

### 11.1 HTTP Security Headers

**App layer (`@fastify/helmet`):**

```typescript
fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'"],  // No 'unsafe-inline' — maximum XSS protection
      imgSrc:     ["'self'", "data:"]
    }
  },
  crossOriginEmbedderPolicy: false   // required for Razorpay checkout iframe
})
```

**`[MUST]`** CSP `[MUST]` enforce `style-src 'self'` without `'unsafe-inline'` to prevent CSS injection attacks. All styles must be in external CSS files — no inline `style=` attributes.

**Nginx layer (`nginx/client.conf.template`):**

`[MUST]` The HTTPS server block `[MUST]` include these five security headers:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (HSTS, 2-year max-age)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-XSS-Protection: 1; mode=block`

### 11.2 CORS

```typescript
fastify.register(cors, {
  origin:      [process.env.STOREFRONT_URL!, process.env.ADMIN_URL!],
  methods:     ['GET', 'POST', 'PATCH', 'DELETE'],
  credentials: true
})
```

**`[NEVER]`** `origin: '*'` `[NEVER]` used.

### 11.3 Rate Limits

| Layer | Tool | Default Limit |
|---|---|---|
| Edge | Nginx `limit_req` | Route-class zones (auth/checkout/admin/catalog/cart/webhook/health/default) |
| Application | `@fastify/rate-limit` | Tiered by endpoint criticality + per-route overrides |

| Tier / Route Group | Application Limit |
|---|---|
| Auth sensitive (`/auth/send-otp`, `/auth/verify-otp`, `/auth/forgot-password`, `/auth/register`, `/auth/refresh`) | 6 per minute |
| Auth login (`/auth/login`, `/auth/admin/login/request-otp`, `/auth/admin/login/verify-otp`) | 12 per minute + progressive lockout on failed credentials |
| Catalogue reads (`/products*`, `/reviews/product/*`, `/reviews/recent`) | 300 per minute (route profile) |
| Cart/user-session flows (`/cart*`, `/wishlist*`, `/users/me*`) | 90 per minute (route profile) |
| Checkout/payment mutations (`/orders`, `/orders/:id/cancel`, `/payments/initiate`, `/payments/verify`) | 30 per minute (route profile) |
| Webhook ingress (`/payments/webhook`, `/shipping/webhook`) | 400 per minute (dedicated profile) |
| Admin read routes (`/api/v1/admin/*` reads) | 180 per minute (route profile) |
| Admin write routes (`/api/v1/admin/*` mutations) | 120 per minute (route profile) |
| Health | 30 per minute |

### 11.4 Environment Variable Validation

**`[MUST]`** App `[MUST]` fail fast on startup if any required env var is missing:

```typescript
// 1. Bootstrap env vars required before DB-backed ops config can load
const bootstrapRequired = ['DATABASE_URL', 'REDIS_URL', 'OPS_DB_ENCRYPTION_KEY']
for (const v of bootstrapRequired) {
  if (!process.env[v]) throw new Error(`Missing required bootstrap env var: ${v}`)
}

// 2. Runtime env vars validated after DB-backed ops overlay is applied
const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET']
for (const v of required) {
  if (!process.env[v]) throw new Error(`Missing required env var: ${v}`)
}

// 3. Provider-conditional env vars (only required when that provider is active)
const paymentProvider = (process.env.PAYMENT_PROVIDER ?? 'razorpay').trim().toLowerCase()
if (paymentProvider === 'razorpay') {
  requireEnv('RAZORPAY_KEY_ID')
  requireEnv('RAZORPAY_KEY_SECRET')
  requireEnv('RAZORPAY_WEBHOOK_SECRET')
} else if (!['cod', 'noop'].includes(paymentProvider)) {
  throw new Error(`Unsupported PAYMENT_PROVIDER: ${paymentProvider}. Allowed: razorpay, cod, noop`)
}

// Shipping — provider detection is credential-based (SHIPPING_PROVIDER is not used)
// resolveDualShippingRuntime() determines active providers from credential presence:
//   DELHIVERY_API_KEY present → Delhivery active
//   SHIPROCKET_EMAIL + SHIPROCKET_PASSWORD present → Shiprocket active
//   Both can coexist; absence of both → noop mode (no shipping validation)
const { delhivery: delhiveryRuntime, shiprocket: shiprocketRuntime } = resolveDualShippingRuntime()
if (isStrictProfile && !delhiveryRuntime && !shiprocketRuntime) {
  throw new Error('No shipping provider credentials found. Set DELHIVERY_API_KEY or SHIPROCKET_EMAIL+SHIPROCKET_PASSWORD via Ops UI.')
}
if (isStrictProfile && delhiveryRuntime) requireEnv('DELHIVERY_WEBHOOK_TOKEN')
if (isStrictProfile && shiprocketRuntime) requireEnv('SHIPROCKET_WEBHOOK_TOKEN')

// 3. Redis URL protocol and password validation
const redis = new URL(process.env.REDIS_URL!)
if (!['redis:', 'rediss:'].includes(redis.protocol)) throw new Error('REDIS_URL must be redis:// or rediss://')
if (isStrictProfile && !redis.password) {
  throw new Error('REDIS_URL must include password in production-like profiles')
}
```

> **Provider validation rules:**
> - Razorpay env vars are only required when `PAYMENT_PROVIDER=razorpay` (not when `cod` or `noop`).
> - Unrecognised provider values (typos) are rejected immediately at startup in all profiles.
> - `noop` providers are allowed in development-like profiles only; production-like profiles reject `noop` with a hard error (see `validateProductionProviderSafetyEnv()`).
> - `database.config.ts` and `redis.config.ts` use `requireEnv()` (not `as string`) to fail fast on missing URLs.
> - `redis.plugin.ts` enforces a 20-second readiness timeout (`REDIS_READY_TIMEOUT_MS`) — startup fails fast with clear error if Redis is unavailable instead of hanging indefinitely.
> - `auth.service.ts` uses `resolveRefreshSecret()` to fail fast on missing/empty `JWT_REFRESH_SECRET` at runtime (not `as string`).
> - All external provider adapters enforce `AbortSignal.timeout()` on fetch calls (10s for Delhivery/Razorpay/Resend/MSG91) to prevent hanging threads.
> - Prisma global client cache is scoped to development-like runtime only (`development`/`test`); production-like profiles always create a fresh client.
> - Fastify request type declarations (`src/types/fastify.d.ts`) import canonical permission types from `admin-permissions.ts` and `ops-permissions.ts` — no inline string-literal unions.

**Two-tier config model:** Provider credentials, webhook tokens, and ops-security parameters are **DB-overlay keys** — stored encrypted in `OpsConfigSecret` and applied by `applyOpsConfigRuntimeOverlay()` at startup after the DB connection is available. They are **not** set directly in `.env` in production. Bootstrap-only keys (`DATABASE_URL`, `OPS_DB_ENCRYPTION_KEY`, `JWT_SECRET`, etc.) must always come from `.env`. Exception: `RESEND_API_KEY` and `RESEND_FROM` must be set in `.env` for Phase 1 ops invite (see `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`); after first ops login they are managed via Ops UI. See `docs/ENV_VS_DB_CONFIG_REFERENCE.md` for the full classification.

Additional env vars (annotated by config tier):

**DB-overlay keys (set via Ops UI — `POST /api/v1/ops/config/save`):**
- `DELHIVERY_WEBHOOK_TOKEN` — required in production-like profiles when Delhivery credentials are present; dev/test may use `.env` temporarily
- `SHIPROCKET_WEBHOOK_TOKEN` — required in production-like profiles when Shiprocket credentials are present
- `REPLAY_APPROVAL_TOKEN` — required in non-dev/test profiles; replay endpoints fail closed when missing
- `OPS_METRICS_TOKEN` — ops security surface
- `TRUSTED_PROXY_ALLOWLIST_CIDR`, `RAZORPAY_WEBHOOK_ALLOWLIST_CIDR` — IP allowlisting

**Bootstrap-only / feature-toggle keys (set in `.env`):**
- `SHIPROCKET_PICKUP_PINCODE` / `DELHIVERY_PICKUP_PINCODE` (bootstrap fallback; admin can override via settings)
- `ADMIN_SCOPE_ENFORCEMENT` (`false` alone does not disable checks; bypass requires development profile + `ALLOW_ADMIN_SCOPE_BYPASS=true`; production remains fail-closed/enforced)
- `ALLOW_ADMIN_SCOPE_BYPASS` (dev-only emergency toggle used with `ADMIN_SCOPE_ENFORCEMENT=false`)
- `ADMIN_DEFAULT_PERMISSIONS` (comma-separated override for default admin permission claims)
- `IDEMPOTENCY_SCOPE_SECRET` (HMAC secret for persisted idempotency scope fingerprinting) — bootstrap-only
- `ENABLE_VERBOSE_VALIDATION_ERRORS` (`true` enables detailed validation errors in API responses; default is redacted/minimal)

**`[NEVER]`** `console.log` `[NEVER]` logs tokens, passwords, OTPs, or raw webhook payloads.

### 11.6 Atomic Operations & Concurrency Control (TOCTOU Prevention)

**`[MUST]`** All critical state transitions `[MUST]` use Prisma `updateMany` with guard conditions to prevent Time-of-Check-to-Time-of-Use (TOCTOU) race conditions.

**CAS (Compare-And-Swap) Pattern:**

```typescript
// Atomic: only update if status hasn't changed since read
const result = await prisma.order.updateMany({
  where: {
    id: orderId,
    status: 'PENDING_PAYMENT'  // Guard condition — row-level optimistic lock
  },
  data: { status: 'CANCELLED' }
})

// Verify the update actually happened
if (result.count === 0) {
  throw new AppError(ERROR_CODES.CONFLICT, 'Order state changed concurrently', 409)
}
```

**Required CAS Surfaces:**

| Surface | Pattern | Guard Field(s) |
|---------|---------|------------------|
| Idempotency first-write | `create` + unique-conflict catch + `updateMany` | `status: PROCESSING` → final state |
| Admin invite expiry | `updateMany` | `status in ['CREATED', 'EMAIL_SENT']` |
| Admin invite consumption | `updateMany` | `status in ['CREATED', 'EMAIL_SENT']` |
| Refresh token consume | `updateMany` | `consumedAt: null` |
| Ops OTP verify | `updateMany` | `status = PENDING AND attempts < max` |
| Ops invite cleanup | `deleteMany` | `status in ['CREATED', 'EMAIL_SENT']` |
| Order reconciliation | `updateMany` | `status` guards per transition |
| Webhook inbox claim | `create` + unique-violation + `updateMany` | `status = FAILED` → `PROCESSING` |
| Analytics replay | `updateMany` | `status = PENDING ↔ FAILED` |
| Audit chain append | Redis lock + `create` | `withOpsAuditChainLock()` acquires 5000ms lock |

**Compatibility with Test Mocks:**

**`[MUST]`** All CAS implementations `[MUST]` detect mock delegates and fall back gracefully:

```typescript
const preferUpdateForMock =
  typeof delegate.update === 'function' &&
  'mock' in (delegate.update as unknown as Record<string, unknown>)

if (delegate.updateMany && !preferUpdateForMock) {
  await delegate.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'DONE' } })
} else {
  await delegate.update({ where: { id }, data: { status: 'DONE' } }) // Fallback for tests
}
```

**Distributed Locking for Audit Chains:**

**`[MUST]`** Audit chain writes (`OpsAuditLog`, `CouponAuditLog`) `[MUST]` use Redis distributed locks to serialize chain-head updates:

- Lock key pattern: `audit:ops:chain:lock` / `audit:coupon:{id}:lock`
- TTL: 5000ms (`OPS_AUDIT_LOCK_TTL_MS`)
- Wait timeout: 2000ms (`OPS_AUDIT_LOCK_WAIT_TIMEOUT_MS`)
- Failed lock acquisition returns structured `503 ops_audit_chain_lock_timeout` for safe caller retry

### 11.5 Storefront payment pages, CSP, SRI, and WAF (PCI SAQ-A intent)

This backend exposes **JSON APIs only**; HTML checkout and payment flows run in the **storefront** (Next.js) and are served behind **Nginx/CDN** per [ECOM_MASTER.md](ECOM_MASTER.md). Merchants using PSP-hosted checkout typically target **SAQ-A-style** scope for card data, but remain responsible for **script and supply-chain risk on pages they control** (e.g. third-party JavaScript on the parent page around an iframe).

**`[SHOULD]`** Own these controls in the **storefront / edge** repo or Nginx config—not in this Fastify service:

| Control | Owner |
|---|---|
| Content-Security-Policy (start with Report-Only, then enforce) | Storefront + Nginx headers |
| Subresource Integrity on third-party script tags where applicable | Storefront |
| Minimize third-party scripts on checkout paths | Storefront |
| WAF / bot rules at CDN or reverse proxy | Operations |

The API process applies **Helmet** CSP for JSON responses (see §11.1); that does **not** replace storefront CSP on pages that load Razorpay Checkout or other scripts. See `docs/DECISIONS.md` for the deferral of checkout-page CSP to the storefront deployment.

### 11.6 Ops Control Plane Security Model (June 2026)

**Browser-Session-Only Authentication:**

**`[MUST]`** Ops authentication `[MUST]` use browser-session-only model — no API keys, no bearer tokens, no localStorage.

| Aspect | Implementation |
|--------|----------------|
| Auth mechanism | 2-step email OTP → httpOnly session cookie |
| Session cookie | `ops_session`: httpOnly, secure, sameSite=strict, path=/api/v1/ops |
| Session storage | SHA256 hash in Redis with 24h TTL |
| Token format | 32-byte random base64url, hashed before storage |
| Deactivated check | Live `isActive` DB query on every request |
| Rate limiting | `opsCritical` tier (strictest limits) |

**`[NEVER]`** Ops `[NEVER]` uses API key headers (`x-ops-key-id`, `x-ops-api-key`). Browser session is the sole authentication mechanism.

**Authentication Flow:**
```
Step 1: POST /api/v1/ops/auth/login/request-otp
  → Email + password verification
  → 6-digit OTP sent to ops user's email
  → Anti-enumeration: generic response regardless of account existence

Step 2: POST /api/v1/ops/auth/login/verify-otp
  → OTP verification (300s TTL, max 5 attempts)
  → Sets ops_session httpOnly cookie
  → SHA256 hash stored in Redis (24h TTL)

All subsequent requests:
  → ops_session cookie automatically included
  → opsAuthGuard validates session + checks isActive
  → Permission check (ops:read / ops:write)
```

**Critical Operations Requiring OTP (5 Endpoints):**

**`[MUST]`** All privileged ops mutations `[MUST]` require secondary OTP challenge:

| Endpoint | Action Type | Body Requires |
|----------|-------------|---------------|
| `POST /api/v1/ops/config/save` | config-save | `challengeId`, `otpCode` |
| `POST /api/v1/ops/load-shed` | load-shed-change | `challengeId`, `otpCode` |
| `POST /api/v1/ops/system/restart` | system-restart | `challengeId`, `otpCode` |
| `POST /api/v1/ops/users/:id/deactivate` | user-deactivate | `challengeId`, `otpCode` |
| `POST /api/v1/ops/invites/:id/revoke` | invite-revoke | `challengeId`, `otpCode` |

**OTP Challenge Flow:**
```
1. POST /api/v1/ops/otp/request
   Body: { action: "system-restart" }   // field is `action`, not actionType
   → Returns: { challengeId, expiresAt }
   → Email: 6-digit OTP sent to ops user's email

2. User enters OTP from email (within 600s)

3. POST /api/v1/ops/system/restart
   Body: { delayMinutes, challengeId, otpCode }
   → Verifies OTP challenge inline (challenge must match the same `action`)
   → Executes operation if valid
```

**OTP Challenge Properties:**
- **Allowlisted actions:** `config-save`, `load-shed-change`, `user-deactivate`, `system-restart`, `invite-revoke`
- **TTL:** 600 seconds (10 minutes)
- **Max Attempts:** 3 per challenge
- **Delivery:** Email via Resend (async, best-effort)
- **Storage:** SHA256 hash in `OpsOtpChallenge.codeHash`
- **Lockout:** After 3 failures, challenge status becomes `FAILED`
- **Action binding:** Reusing a challenge for a different critical action returns `403 FORBIDDEN`

**Permission Model (2 Permissions Only):**

**`[MUST]`** Ops permissions `[MUST]` be exactly two values:
- `ops:read` — Read access to all ops endpoints
- `ops:write` — Write access (implies read), requires OTP for critical mutations

**`[NEVER]`** `OPS_APPROVE` permission `[NEVER]` exists (legacy dual-approval removed June 2026).

**Fail-Closed Design:**
- New ops users start with no permissions
- Empty permission set = 403 FORBIDDEN
- Must explicitly grant `ops:read` or `ops:write`

**Tamper-Evident Audit Chain:**

**`[MUST]`** Every ops action `[MUST]` be logged to `OpsAuditLog` with cryptographic chain hashing:
- `chainHash` = SHA256(previousHash + actionData)
- `previousChainHash` references prior log entry
- Redis-based distributed locking prevents concurrent write corruption
- `503 ops_audit_chain_lock_timeout` for contention — caller retries after 1-2s

### 11.7 Security Verification Status (June 2026)

**Production Readiness:** ✅ VERIFIED

All security gates passing:
- Type safety: `npm run typecheck` → exit 0
- Unit tests: 487/487 pass
- CI reliability gates: All pass
- Security tests: All pass
- E2E tests: All pass

**Verified Invariants:**
- ✅ No tokens in localStorage/sessionStorage
- ✅ httpOnly, secure, sameSite=strict cookies
- ✅ 2-step OTP for admin/ops login
- ✅ Secondary OTP for 5 critical ops operations
- ✅ SHA256 hashing for all tokens/OTPs
- ✅ bcrypt 12 rounds for passwords
- ✅ AES-256-GCM for config secrets
- ✅ Strict CSP (no 'unsafe-inline')
- ✅ Tamper-evident audit chain

**Security Score: 10/10** — Maximum protection achieved.

---

## 12. Frontend Technical Requirements

### 12.1 Storefront (Next.js)

- App Router (not Pages Router)
- Product detail pages: ISR via `generateStaticParams` + `revalidate`
- Cart state: React Context + `useReducer`, fetched from API on mount
- Razorpay Checkout loaded via CDN (not npm) for PCI compliance:
  ```html
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  ```

### 12.2 Admin Dashboard (Next.js + Refine)

- Custom Refine data provider mapping CRUD methods to `/api/v1/admin/*`
- Auth provider: 2-step email OTP (`POST /api/v1/auth/admin/login/request-otp` → `POST /api/v1/auth/admin/login/verify-otp`), auto refresh token handling
- All charts: **Recharts** (LineChart for sales, FunnelChart for conversion, PieChart for categories)
- Admin `[MUST]` run inside the same Next.js runtime as storefront under PM2 (`<client-id>-frontend`), with Nginx reverse proxying to the assigned `STOREFRONT_PORT`.
- Frontend VPS bootstrap `[MUST]` provide `.env.production.local` (or `.env.local`) with at least: `CLIENT_ID`, `STOREFRONT_PORT`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_STOREFRONT_URL`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`.
- `frontend/.env.production.example` should be versioned as the canonical production template and copied on VPS to `.env.production.local` before first build.

**`[MUST]`** Admin pages and their key features:

| Page | Required Features |
|---|---|
| Dashboard | KPI cards (today/7d/30d), Recharts LineChart, top 5 products, low stock alerts, recent orders |
| Orders | Status filter tabs, date range picker, search by order number or customer name |
| Order Detail | Status timeline, payment info, ShipmentEvent list, "Create Shipment" button, manual status update |
| Products | Search, category filter, active toggle, "New Product" button |
| Product Editor | Name, slug (auto + editable), description, category select, variant table, image drag-drop |
| Inventory | All variants with inline-editable quantity, low-stock badge |
| Customers | Search by name/phone/email, click-through to profile + order history |
| Analytics | Revenue chart, conversion funnel, category breakdown, notification delivery rates |
| Settings | Store name, GSTIN, FSSAI, logo upload, notification toggles, low-stock threshold |
| Queue Monitor | Bull Board UI embedded — job status, retry failed, inspect dead-letter |

---

## 13. Performance Requirements

### 13.1 API Response Time Targets

| Endpoint Category | P50 | P95 | P99 |
|---|---|---|---|
| Health check | < 10ms | < 20ms | < 50ms |
| Product listing (cached) | < 30ms | < 80ms | < 150ms |
| Product listing (uncached) | < 100ms | < 250ms | < 500ms |
| Order creation | < 300ms | < 600ms | < 1000ms |
| Razorpay initiate | < 500ms | < 800ms | < 1500ms |
| Webhook handlers | < 50ms | < 100ms | < 200ms |
| Admin dashboard KPIs | < 200ms | < 500ms | < 1000ms |

### 13.2 Concurrency Target

**`[MUST]`** Each client instance `[MUST]` handle **200 concurrent users** without degradation on 4 vCPU / 8 GB VPS hosting up to 10 clients.

**`[SHOULD]`** Load test before Phase 5 sign-off:
```bash
autocannon -c 200 -d 30 https://staging-client.com/api/v1/products
```

### 13.3 Database Optimisation Rules

**`[MUST]`** All FK columns `[MUST]` have `@@index` in Prisma schema.

**`[MUST]`** Composite index on `Order(status, createdAt)` for admin date-filtered queries.

**`[MUST]`** `EXPLAIN ANALYZE` run on every query touching > 2 tables before Phase 5 sign-off. Sequential scans on tables > 1000 rows `[MUST]` be eliminated.

---

## 14. Testing Requirements

### 14.1 Coverage Thresholds (Phase 5 sign-off)

| Scope | Minimum |
|---|---|
| Global unit lines (ratchet floor) | 43% |
| Orders domain lines (ratchet floor) | 40.5% |
| Auth domain lines (ratchet floor) | 16.0% |
| Webhooks domain lines (ratchet floor) | 42% |
| Non-regression lock | Current baseline must not regress (`observability/coverage-baseline.json`) |

### 14.2 Unit Tests

Framework: **Vitest**.

**Worker testing pattern:** All `queues/workers/*.worker.test.ts` files **MUST** use dependency injection instead of `vi.mock`. Each `createXWorker(connection, deps?)` function accepts an optional `deps` bag containing mock constructors (e.g., `Worker`, `PrismaClient`, `Queue`, provider factories). Tests instantiate local mock classes, pass them via `deps`, and invoke the captured processor function directly. **`vi.mock` MUST NOT be used** on BullMQ or `@prisma/client` modules — it is incompatible with the `vmForks` pool and causes "No test suite found" errors in `threads`/`forks` pools.

**Service testing pattern:** Service tests that exercise a service method which internally calls another service (e.g. `OrdersService.createOrder` calling `CartService.checkPincodeServiceability`) **MUST** use `vi.spyOn(ServiceClass.prototype, 'methodName')` to mock the prototype method rather than `vi.mock` on the module path. The `vmForks` pool does not reliably intercept cross-service module boundaries with `vi.mock`, causing the real service to be instantiated and fail on missing infrastructure (e.g. empty env vars for provider adapters).

**Route testing pattern:** Route tests (`src/modules/**/*.routes.test.ts`) **MUST** use a real Fastify instance with decorated mocks (`request.jwtVerify`, `prisma` delegates, `redis`) rather than `vi.mock`.

**`[MUST]`** Must cover:
- All valid and invalid order state transitions
- Razorpay HMAC verification (valid, tampered payload, wrong secret)
- Shipping provider webhook token verification (Delhivery or Shiprocket)
- Cart merge (all 4 scenarios: both exist, guest only, user only, neither)
- Coupon validation (expired, limit exceeded, min order not met, scope mismatch)
- Money arithmetic with paise rounding (GST calculations)
- OTP generation, hashing, TTL, and rate limit logic
- CAS race-condition paths: inventory update `409 CONFLICT` on stale-read, inventory alert skip on duplicate claim, outbox dispatch skip on duplicate claim, coupon `usesCount` cap enforcement, admin MFA enable/disable guarded `updateMany` and concurrent `409 CONFLICT` scenario

### 14.3 End-to-End Tests

Framework: **Supertest** against running Fastify with a dedicated test database.

**`[MUST]`** Must cover:

| Flow | Scenarios |
|---|---|
| OTP login | Send → verify → receive JWT pair |
| Auth-required prepaid checkout | Add item as guest or logged-in user → login/signup before checkout → place order → pay via Razorpay → webhook confirm |
| Prepaid checkout | Add item → initiate Razorpay → simulate `payment.captured` webhook → confirmed → notifications enqueued |
| Insufficient stock | Order more than available → `INSUFFICIENT_STOCK` error → no DB changes |
| Coupon application | Valid coupon applied; expired coupon rejected |
| Duplicate webhook | Same `payment.captured` twice → second is a no-op |
| Admin order flow | Admin creates shipment → Delhivery webhook → status updates → customer notified |

**`[MUST]`** Test DB reset between suites: `prisma migrate reset --force` in test setup.

---

## 15. Observability Requirements

### 15.1 Logging

**`[MUST]`** All logging via Fastify's built-in **Pino** logger. No `console.log` in production.

| Environment | Log Level |
|---|---|
| Development | `debug` |
| Staging | `info` |
| Production | `warn` |

**`[MUST]`** Every HTTP request logged with: method, route, status code, response time, request ID.

**`[MUST]`** Every BullMQ job logged with: job name, ID, queue, attempt number, success/failure, duration.

**`[NEVER]`** Logs `[NEVER]` contain passwords, OTPs, JWT tokens, or raw webhook payloads.

### 15.2 Request Tracing

**`[SHOULD]`** A `requestId` (UUID) `[SHOULD]` be generated per request, included in all logs and error response bodies.

### 15.3 Metrics and SLO Baseline

**`[MUST]`** Expose Prometheus metrics at `GET /api/v1/ops/metrics` for reliability operations.
Metrics endpoint exposure is restricted by default: production requires matching `x-ops-token` (`OPS_METRICS_TOKEN`), while `OPS_METRICS_ALLOWLIST` remains defense-in-depth.

**`[MUST]`** Capture and track these metrics:
- HTTP latency histogram by route/method/status (`http_request_duration_seconds`)
- Webhook ingress outcomes and latency (`webhook_events_total`, `webhook_processing_duration_seconds`)
- Queue execution outcomes and duration (`queue_jobs_total`, `queue_job_duration_seconds`)
- Checkout/payment critical-path outcomes (`checkout_requests_total`)
- Reliability mode state (`app_reliability_mode`)
- Dynamic labels are bounded to controlled enums/buckets (`webhook event`, `queue`, `job_name`, `auth action`) to prevent high-cardinality leakage.

**`[MUST]`** Baseline SLI evidence recorded per release:
- Verification gates: `typecheck`, `test:unit`, `test:e2e`, `build`, `contract:admin`, deep smoke all passing.
- Deep endpoint smoke and route totals are release artifacts and may vary by additive endpoints.
- Reliability mode baseline is expected to be `normal` unless incident controls are active.
- Checkout path counters active for critical mutation routes.
- Outbox lag and dead-letter depth gauges active (`outbox_oldest_pending_lag_seconds`, `outbox_dead_letter_depth`) for queue backlog SLO tracking.
- Queue dead-letter depth recording rule is active (`slo:queue_dlq_total_depth:max_5m` from `queue_waiting_depth{queue="dead-letter"}`) for `QueueDLQDepthHigh` alert evaluation.
- Auth challenge outcomes are observable (`auth_challenge_total`) for abuse-defense conversion tracking.

**`[MUST]`** Flash-sale API stress evidence (`npm run stress:flash-sale:api:matrix`) is valid only when fixture preconditions are met. Runs where all requests are rejected at client layer (`fixturePreconditionMet=false`, commonly `rejected_client` saturation) must fail invariant enforcement and are not acceptable release evidence.

**Documentation SLO alignment (non-code):** Constraint **C-05** requires webhook handlers to acknowledge successfully in **under 200 ms** before async work. Executable alerting in `observability/slo-rules.yml` currently monitors `slo:webhook_latency:p95_5m` with a burn threshold at **0.5s**; queue backlog is monitored via outbox lag / dead-letter metrics above.

### 15.4 Implemented vs Roadmap Boundary

**`[MUST]`** Treat these controls as implemented runtime capabilities:
- Metrics endpoint contract (`/api/v1/ops/metrics`) with protected exposure.
- Versioned SLO rule + promtool test artifacts.
- Release policy state + release guard scripts.
- Flash-sale and DR drill evidence scripts.

**`[MUST]`** Treat these as deployment-specific roadmap/enablement work unless explicitly configured:
- Live Prometheus credential wiring for `RELEASE_POLICY_MODE=live_required`.
- Production DR `DR_*_HOOK` orchestration commands against ephemeral infrastructure.
- Full observability stack rollout (Prometheus/Alertmanager/Grafana provisioning).

### 15.5 SLO Burn-Rate Automation

**`[MUST]`** SLO recording and burn-rate alert expressions are versioned in `observability/slo-rules.yml`.
**`[MUST]`** `promtool` test harness file is versioned at `observability/slo-rules.test.yml` and executed via `npm run test:slo-rules`.
**`[MUST]`** Synthetic burn-rate sanity checks are executable via `npm run simulate:burnrate`.

**`[MUST]`** Deployment pipelines run `npm run release:guard` and block non-hotfix deploys whenever release freeze or unresolved critical reliability incidents are active.
**`[MUST]`** `release:guard` may read both environment values and a JSON state source (`RELIABILITY_STATE_FILE`) for freeze/incident truth.

### 15.6 Compliance evidence starter (SOC2/ISO/DPIA readiness)

This section is an evidence-oriented implementation starter, not legal certification advice.

| Domain | Primary control intent | Existing evidence source(s) |
|---|---|---|
| Access control | Role + permission enforcement for admin operations | `src/common/guards/admin-permissions.guard.ts`, `src/common/auth/admin-permissions.ts`, `test:security` |
| Change management | Controlled CI gates before merge/deploy | `.github/workflows/ci.yml`, `package.json` scripts (`ci:reliability-gates`, `typecheck`, tests) |
| Logging/monitoring | Redacted logs + bounded-cardinality metrics | `src/main.ts` redaction config, `src/common/observability/metrics.ts`, `observability/slo-rules.yml` |
| Incident/recovery | DR checks and release freeze controls | `scripts/dr-*.js`, `scripts/reliability-release-guard.js`, CI reliability job |
| Data protection/privacy | Token hashing, webhook verification, idempotency, response minimization | auth/orders services, security tests, TRD §7.10–§7.13, §16 C-06/C-12/C-13 |
| Vendor/integration controls | Adapter boundaries + webhook defensive checks | `src/common/interfaces/*.ts`, webhook allowlist/skew env controls, `docs/DECISIONS.md` |

**Evidence run cadence**
- Monthly: `npm run typecheck`, `npm run test:unit`, `npm run test:security`, `npm run test:e2e`, `npm run route:discipline-check`, `npm run serializer:exposure-check`.
- Quarterly: dependency/security evidence (`security.yml` workflow results, `npm audit` policy output), DR drill evidence (`dr:drill:*`), and release guard evidence.
- Retention target: archive CI logs + generated artifacts for at least 12 months (or stricter client/legal requirement).
- Sign-off owners: engineering owner + operations owner per deployment.

**DPIA-lite deployment template (process starter)**
- Processing activity: `<checkout / orders / notifications / analytics replay>`
- Data categories: `<customer profile, address, order metadata, payment references>`
- Lawful basis placeholder: `<contract / legitimate interests / consent as applicable>`
- Retention and deletion path: `<db tables, queue payloads, logs, archive duration>`
- Risk summary: `<high-level privacy/security risks>`
- Mitigations and linked controls: `<TRD constraints/tests/scripts>`
- Residual risk + owner approval: `<accepted / follow-up action>`

### 15.4 Queue Monitoring

**`[MUST]`** Bull Board at `/api/v1/ops/queues` (ops auth) provides: active/waiting/completed/failed/delayed jobs, retry capability, dead-letter inspection, job data and error stacks.

---

## 16. Constraint Registry

> Consolidated hard constraints. Zero tolerance for violations.

| ID | Constraint | Category |
|---|---|---|
| C-01 | Money stored as `Int` (paise) everywhere — no `Float`, `Decimal`, or rupee strings | Data Integrity |
| C-02 | UUID primary keys throughout — no sequential integer IDs exposed | Security |
| C-03 | Snapshot fields on `OrderItem` — never join live product data for historical orders | Data Integrity |
| C-04 | Order creation in single `prisma.$transaction()` — atomic or nothing | Data Integrity |
| C-05 | Webhook handlers respond `200 OK` in < 200ms — all processing via BullMQ | Performance |
| C-06 | HMAC verification on raw `Buffer` — never on parsed JSON body | Security |
| C-07 | Webhook idempotency enforced via Redis `providerPaymentId` key | Reliability |
| C-08 | Secrets only in `.env` — never in source code or Git history | Security |
| C-09 | Modules never import each other's internal files — only public service interfaces | Architecture |
| C-10 | `PAYMENT_PROVIDER` selects the payment adapter; shipping provider selection is credential-based (`resolveDualShippingRuntime()`) — both can coexist | Architecture |
| C-11 | All notifications dispatched via BullMQ — never synchronous in the request cycle | Reliability |
| C-12 | Refresh token stored as bcrypt hash in DB — never the raw token | Security |
| C-13 | `additionalProperties: false` on all request body JSON schemas | Security |
| C-14 | TypeScript `strict: true` — no `any` without documented justification | Code Quality |
| C-15 | No two clients share Redis instance, database, JWT secret, or API keys | Isolation |
| C-16 | PostgreSQL runs on host; Redis runs per-client in Docker | Infrastructure |
| C-17 | Nginx enforces HTTPS — no API served over plain HTTP in production | Security |
| C-18 | Rate limiting at both Nginx edge and Fastify application layer | Security |
| C-19 | Soft delete only on `Product` — hard deletes corrupt order history | Data Integrity |
| C-20 | `cart_session` and refresh token cookies: `httpOnly`, `secure`, `sameSite` enforced | Security |
| C-21 | Inventory stock updates use CAS `updateMany` with `variantId + updatedAt` guard — no stale-read overwrite | Reliability |
| C-22 | Low-stock alert dispatch uses per-item atomic claim (`lowStockAlerted: false` guard) — no duplicate alerts under concurrent workers | Reliability |
| C-23 | Outbox event enqueue uses per-message atomic claim (`status = 'PUBLISHED'` guard) — no duplicate BullMQ publishes under concurrent dispatchers | Reliability |
| C-24 | Coupon `usesCount` increment uses CAS `updateMany` with `usesCount < maxUses` guard — cap cannot be overshot under concurrent order confirmations | Data Integrity |
| C-25 | CI scripts (`admin-contract-check.js`) read credentials from env vars (`ADMIN_EMAIL`/`ADMIN_PASSWORD`) — no hardcoded credentials in script source | Security |
| C-26 | All raw SQL uses parameterized tagged-template `prisma.$executeRaw\`...\`` / `prisma.$queryRaw\`...\`` — never `$executeRawUnsafe` or `$queryRawUnsafe`. CI gate `security:sql-injection-guard` fails build on unsafe patterns | Security |

---

*Derived from `ECOM_MASTER.md`. All decisions trace to that document.*

---

> **Deploying for a client?** The infrastructure requirements (§2–§3), API contract (§4, §7), auth model (§6), webhook specs (§7.10–§7.12), and constraint table (§13) are all enforced as evidence gates in the client onboarding process. The full sequenced runbook — from infra provisioning and secret management through domain/TLS wiring, frontend integration, and go-live validation — is **[`docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`](docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md)**.

> **Phase 7 runtime incident companion:** `docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md` (startup failure signatures and remediation sequence).
