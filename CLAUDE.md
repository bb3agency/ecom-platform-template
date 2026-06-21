# E-Commerce Frontend — Antigravity Development Rules

> **Activation:** Always On
> **Scope:** All files in this workspace
> **Usage:** Assuming sibling folders (`root/backend` and `root/frontend`), copy this file from the backend into `.agents/rules/dev-rules.md` of the frontend project.
> **Pairs with:** The Fastify e-commerce backend template (located in the sibling `../backend` folder).
>
> **Lifecycle:** This is a **build-time rules file**. After development/go-live, treat `docs/CLIENT_HANDOFF_INDEX.md` and its linked Client-Main docs as primary for client-facing operations.

Phase-aware documentation precedence (mandatory):
- During build: use engineering SOP docs (for example `README.md`, `docs/MASTER_DEPLOYMENT_PLAYBOOK.md`, `starter-prompt.md`, this rules file, and related integration/build docs).
- After development/go-live: use `docs/CLIENT_HANDOFF_INDEX.md` first, then client-main docs it links.
- Do not present template-general SOP docs as the primary client-facing handoff baseline unless troubleshooting implementation history.

Sync verification (required before release):

```bash
cp ../backend/frontend-agent-rules.md .agents/rules/dev-rules.md
diff -u ../backend/frontend-agent-rules.md .agents/rules/dev-rules.md
```

If `diff` output is non-empty, re-sync and commit the updated `.agents/rules/dev-rules.md` in the frontend repo.

---

## 0. Mandatory Session-Start Protocol (run before every session)

**At the start of every session, before writing any code or asking questions:**

1. **Read `docs/FRONTEND_DEV_LOG.md`** (in this frontend repo). If it does not exist, tell the user to copy it from `../backend/docs/FRONTEND_DEV_LOG_TEMPLATE.md` and fill in the Project Identity section before continuing.
2. **Identify the current tier and next incomplete slice** from the Slice Tracker.
3. **Confirm backend `.env` bootstrap keys are correctly configured** — BEFORE running any script, verify ALL of the following in the backend `.env`.
   > **Architecture note:** Provider API keys (Razorpay, Delhivery, Shiprocket, MSG91, Fast2SMS, Resend, Meta WhatsApp, etc.) are **NOT stored in `.env`** in production. They are stored encrypted in the `OpsConfigSecret` database table and loaded at runtime via the Ops config overlay. The `.env` file only contains **bootstrap keys** that must exist before the DB is reachable.
   - `CLIENT_ID` is set to a client-specific slug (e.g. `your-client-slug`) — **not** `ecom` or empty. Docker container names are derived from this value (`<CLIENT_ID>-postgres`, `<CLIENT_ID>-redis`).
   - `POSTGRES_DB` uses **underscores only** (e.g. `your_client_db`) — **hyphens are invalid in PostgreSQL DB names** and will cause container init or migration failures.
   - `POSTGRES_DB` and the DB name in `DATABASE_URL` **must match exactly** — mismatch means the bootstrap script creates the wrong DB.
   - `DATABASE_URL` is **not** `ecom_template` and matches the `POSTGRES_DB` value.
   - `REDIS_PASSWORD` is **non-empty** — blank value causes `ECONNABORTED`/`ECONNRESET` loops in ioredis on every reconnect attempt.
   - `REDIS_URL` **embeds the same password** as `REDIS_PASSWORD` (format: `redis://:yourpassword@localhost:6379`) — a URL without password while Redis requires auth will abort all connections.
   - `JWT_SECRET`, `JWT_REFRESH_SECRET`, `OPS_DB_ENCRYPTION_KEY` are set to unique non-placeholder values.
   - If any of the above are wrong, STOP and fix them before proceeding. After fixing, run `docker compose down -v && docker compose up -d postgres redis` to reinitialise containers with correct values. Reference `README.md` §Local Development Quickstart Step 1 for the full annotated `.env` block.
4. **Confirm backend is running AND healthy** — verify ALL of the following before writing frontend code:
   - Backend server (`npm run dev:e2e`) and workers (`npm run dev:e2e:workers`) are running
   - **Health check passes:** `curl http://localhost:3000/api/v1/health` returns `{"success":true,"data":{"status":"ok","db":"connected","redis":"connected"}}`
   - If `db` shows `disconnected` → `DATABASE_URL` wrong or migrations not applied — re-run `npm run dev:e2e`
   - If `redis` shows `disconnected` → `REDIS_URL`/`REDIS_PASSWORD` mismatch — fix `.env` then `docker compose down -v && docker compose up -d postgres redis`
   - **Database is migrated:** `npx prisma migrate status --schema prisma/schema.prisma` shows "Database schema is up to date"
   - **Feature flags are set** in backend `.env` (ask which are enabled: `FEATURE_COUPONS_ENABLED`, `FEATURE_REVIEWS_ENABLED`, `FEATURE_WISHLIST_ENABLED`, `FEATURE_GST_INVOICING_ENABLED`, `FEATURE_RESPONSE_ENVELOPE_ENABLED`). **Storefront reads flags at runtime** via `GET /store/config` (`useStoreConfig()`) — not build-time `NEXT_PUBLIC_FEATURE_*`.
   - If backend is not fully healthy, STOP and guide the user through backend setup first per `README.md` §Local Development Quickstart
   - **Alerting awareness:** The backend emits structured technical failure alerts via email to all active Ops + Admin users on every `catch`/`log.error` path. If the backend is misconfigured (missing Resend keys, no active Ops/Admin users), alert delivery will silently fail. Verify `RESEND_API_KEY` + `RESEND_FROM` are configured and at least one active Ops or Admin user exists in the DB.
5. **Do not ask questions already answered in the project docs/checklists** (e.g. API URL, feature flags, or agreed delivery sequence).

6. **Admin console patterns (2026-06-03):** Date filters are **per-page** via `AdminDateRangePicker` (not shell-global). Product editor maps Status → `isActive`, short description → `metaDescription`, Featured → `isFeatured`. Do not reintroduce mock customer/product labels in admin tables — use API fields (`customerName`, `productName`, etc.). See `docs/FRONTEND_DEV_LOG.md`.

> This protocol is non-negotiable.

---

## 1. Project Identity

This is a **high-conversion e-commerce storefront** built as a headless frontend that consumes the Fastify REST API backend. Every design decision prioritizes conversion rate, performance, and premium visual quality.

- **Framework:** Next.js 15+ (App Router, React Server Components)
- **Language:** TypeScript 5+ (strict mode, `noEmit`, zero `any`)
- **Styling:** Tailwind CSS 4+
- **UI Primitives:** shadcn/ui (Radix-based, copy-pasted — NOT an npm dependency)
- **Icons:** Lucide React — this is the ONLY icon library allowed
- **Animations:** Framer Motion
- **State Management:** Zustand (client-side only — cart, auth, UI state)
- **Data Fetching:** React Server Components + Server Actions
- **Forms:** React Hook Form + Zod resolvers
- **Validation:** Zod (shared schemas between client and server)
- **Images:** `next/image` exclusively — never raw `<img>` tags
- **Fonts:** **Inter** via `next/font/google` in `lib/fonts.ts` (self-hosted subset; sitewide sans + headings). Do not add a second body/heading webfont without explicit approval.

---

## 2. Environment Configuration

- **API URL:** Never hardcode the backend API URL. Always use `process.env.NEXT_PUBLIC_API_BASE_URL`.
- **Public Variables:** For any environment variable that must be exposed to the browser (e.g., client components), ensure it is prefixed with `NEXT_PUBLIC_`.
- **Private Variables:** Never prefix secret keys or server-only credentials with `NEXT_PUBLIC_`.
- **Initial Setup:** BEFORE writing any code, ask the user the following questions in one message (do not start generating code until all are answered):
  1. Backend API URL (local, e.g. `http://localhost:3001/api/v1`)
  2. Store name / brand name
  3. Storefront local URL (e.g. `http://localhost:3101`)
  4. Razorpay **test** key ID (`rzp_test_xxx`) — public key only, never the secret
  5. Whether Resend email is active — confirm `NOTIFY_EMAIL_ENABLED=true` in backend `.env`. The `RESEND_API_KEY` itself is stored in the Ops DB config (not `.env`) and loaded at runtime.
  6. Which SMS provider is active — confirm `SMS_PROVIDER` in backend `.env` (`msg91`, `fast2sms`, or `noop`). The actual API key (`MSG91_AUTH_KEY` or `FAST2SMS_API_KEY`) is stored in Ops DB config, not `.env`.
  7. Whether Meta WhatsApp is active — confirm `NOTIFY_WHATSAPP_ENABLED=true` in backend `.env`. `META_WHATSAPP_ACCESS_TOKEN` and related secrets are stored in Ops DB config, not `.env`.
  8. Which feature flags are active for this client: `FEATURE_COUPONS_ENABLED`, `FEATURE_REVIEWS_ENABLED`, `FEATURE_WISHLIST_ENABLED`, `FEATURE_GST_INVOICING_ENABLED`, `FEATURE_RESPONSE_ENVELOPE_ENABLED`
  9. **Backend bootstrap secrets verification** — these are the only secrets that MUST be in `.env` (they are required before the DB is reachable and cannot be DB-backed):
     - `JWT_SECRET` (unique per client, not placeholder)
     - `JWT_REFRESH_SECRET` (distinct from `JWT_SECRET`, never equal)
     - `OPS_DB_ENCRYPTION_KEY` (32-char hex — encrypts all Ops DB config secrets)
     - All other provider keys (Razorpay, Delhivery, Shiprocket, MSG91/Fast2SMS, Resend, Meta WhatsApp) are entered via the Ops UI → `POST /api/v1/ops/config/save` and stored encrypted in `OpsConfigSecret`.
  10. Whether a `docs/FRONTEND_DEV_LOG.md` already exists in the frontend repo — if not, create one from the template in `../backend/docs/FRONTEND_DEV_LOG_TEMPLATE.md` before writing any code.
  11. **VPS deployment variables** (required if deploying via GitHub Actions CD to a self-hosted runner):
      - `CLIENT_ID` — the client slug used for PM2 process naming (e.g. `greengrocer`). Must match backend `CLIENT_ID`.
      - `STOREFRONT_PORT` — the port PM2 starts Next.js on (e.g. `3101`). Must match Nginx `proxy_pass`.
      These go in `.env.local` (or `.env.production.local`) on the VPS. They are read by `vps-frontend-deploy.sh` for `pm2 reload <client-id>-frontend` and the health check. Not needed in local `.env.local` for development.
      - On VPS first deploy, create runtime env from the tracked template: `cp .env.production.example .env.production.local`. Replace all `PRODUCTION_DOMAIN` placeholders before build.
  Then automatically generate the `.env.local` file with all collected values.
- **Path Prefix:** `NEXT_PUBLIC_API_BASE_URL` MUST include `/api/v1`.
- **Canonical Names:** Use only `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_STOREFRONT_URL` (do not invent alternate names like `NEXT_PUBLIC_API_URL`).

> Configuration source-of-truth for backend env vs DB mapping (what is bootstrap env vs Ops DB overlay, mutability, restart requirements): `docs/ENV_VS_DB_CONFIG_REFERENCE.md`. For the first-deploy Phase 1/2 model (ops-newuser flow and `RESEND_API_KEY` bootstrap): `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`.

### Backend Contract — AI Agent Baseline Enforcement Rules

Canonical contract detail lives in:
- `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`
- `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`
- `docs/BACKEND_GO_LIVE_CHECKLIST.md`
- `docs/ROUTE_SURFACE_COMPLETE_REFERENCE.md` — deep per-route reference: every route's purpose, required permission, data touched, constraints, hard boundaries, and what each layer cannot do. Use this when building any admin, ops, or customer-facing surface to understand exactly what each API call does and what guard it requires.

Mandatory minimum rules:
1. Use only canonical env names and include `/api/v1` in `NEXT_PUBLIC_API_BASE_URL`.
2. Support both success shapes (enveloped/raw) and branch errors by `error.code`.
3. Implement refresh-on-401 with access token in memory and refresh token in HTTP-only cookie flow.
4. Send `idempotency-key` for critical mutations and handle `409` race/conflict responses safely.
5. Implement exact PREPAID/COD split; shipping remains manual-only admin action.
6. Browser never calls webhook routes.
7. Respect deferred refund lifecycle and admin permission token-snapshot behavior.
8. Keep ops config/admin invite UI boundaries aligned with backend contracts.
9. Follow vertical-slice delivery (contract -> client -> UI states -> integration -> tests).
10. Complete paired frontend/backend go-live checklists before release.

---

## 3. Architecture Rules — MUST Follow

### Server Components First
- ALL components are Server Components by default. Add `"use client"` ONLY when the component needs:
  - React hooks (`useState`, `useEffect`, `useRef`, etc.)
  - Browser APIs (`window`, `localStorage`, `navigator`)
  - Event handlers (`onClick`, `onChange`, `onSubmit`)
  - Third-party client libraries (Framer Motion, Zustand)
- **NEVER** put `"use client"` on layout files unless absolutely unavoidable.
- When a Server Component needs an interactive child, use the **children pattern**: pass the Server Component as `children` prop to a Client Component wrapper.

### Data Fetching
- Fetch data directly inside Server Components that need it. No prop drilling from layouts.
- Use `fetch()` with Next.js caching in Server Components.
- Use Server Actions (`"use server"`) for ALL mutations (add to cart, update profile, place order, submit forms).
- After every mutation, call `revalidatePath()` or `revalidateTag()` to bust the cache.
- **NEVER** create API route handlers (`route.ts`) for data that can be fetched in Server Components.
- Do not implement payment/shipping provider webhook receivers in frontend `app/api/*` for this template; provider webhooks terminate at backend `/api/v1/*/webhook` endpoints.

### Folder Structure
```
app/
├── (storefront)/              # Public pages — includes Header + Footer
│   ├── layout.tsx
│   ├── page.tsx               # Homepage
│   ├── products/
│   │   ├── page.tsx           # Product listing (PLP)
│   │   ├── loading.tsx        # Skeleton grid
│   │   └── [slug]/
│   │       ├── page.tsx       # Product detail (PDP)
│   │       └── loading.tsx    # Skeleton detail
│   ├── categories/
│   │   └── [slug]/page.tsx    # Category listing
│   ├── cart/page.tsx
│   ├── checkout/page.tsx
│   ├── search/page.tsx
│   └── pages/[slug]/page.tsx  # CMS static pages (about, contact, etc.)
├── (auth)/                    # Auth pages — no Header/Footer
│   ├── layout.tsx
│   ├── login/page.tsx
│   ├── register/page.tsx
│   └── forgot-password/page.tsx
├── (account)/                 # Protected user area
│   ├── layout.tsx             # Auth guard wrapper
│   ├── dashboard/page.tsx
│   ├── orders/page.tsx
│   ├── orders/[id]/page.tsx
│   ├── addresses/page.tsx
│   ├── wishlist/page.tsx
│   └── settings/page.tsx
├── api/                       # Optional frontend-only handlers (never provider webhooks)
├── layout.tsx                 # Root layout (fonts, providers, metadata)
├── not-found.tsx              # Custom 404
├── error.tsx                  # Global error boundary
└── globals.css                # Design tokens + base styles

components/
├── ui/                        # shadcn/ui primitives (auto-generated)
├── product/                   # Product domain components
├── cart/                      # Cart domain components
├── checkout/                  # Checkout domain components
├── layout/                    # Header, Footer, Navigation, Sidebar
├── marketing/                 # Hero, Banners, Newsletter, Testimonials
└── shared/                    # Rating, PriceDisplay, Badge, EmptyState, Skeleton

lib/
├── api.ts                     # Backend API client (typed fetch wrapper)
├── utils.ts                   # Pure utility functions (cn, formatPrice, etc.)
├── constants.ts               # App-wide constants
├── validators.ts              # Shared Zod schemas
└── fonts.ts                   # next/font definitions

stores/
├── cart.ts                    # Zustand — cart state + localStorage persistence
├── auth.ts                    # Zustand — auth tokens + user session (MEMORY ONLY — never localStorage)
└── ui.ts                      # Zustand — modals, sheets, toasts

types/
├── product.ts
├── cart.ts
├── order.ts
├── user.ts
└── api.ts                     # API response wrapper types

actions/
├── cart.actions.ts            # Server Actions for cart mutations
├── auth.actions.ts            # Server Actions for login/register
├── checkout.actions.ts        # Server Actions for order placement
└── review.actions.ts          # Server Actions for reviews
```

### File Naming
- Components: `PascalCase.tsx` (e.g., `ProductCard.tsx`)
- Hooks: `use-kebab-case.ts` (e.g., `use-cart.ts`)
- Utils/Libs: `kebab-case.ts` (e.g., `format-price.ts`)
- Types: `kebab-case.ts` in `types/` directory
- Server Actions: `kebab-case.actions.ts` in `actions/` directory

---

## 3. Code Standards — MUST Follow

### TypeScript
- **NEVER** use `any`. Use `unknown` + type guards, or define proper interfaces.
- All component props MUST have a named interface: `[ComponentName]Props`.
- Use **named exports** only. No `export default`.
- One component per file. If a component grows beyond 200 lines, split it.
- All shared types live in `types/`. Component-specific types are colocated.

### Components
```tsx
// ✅ CORRECT pattern
interface ProductCardProps {
  product: Product;
  onAddToCart?: (productId: string) => void;
}

export function ProductCard({ product, onAddToCart }: ProductCardProps) {
  // ...
}

// ❌ WRONG — no default export, no inline types, no `any`
export default function ProductCard(props: any) { ... }
```

### Styling
- Use Tailwind CSS utility classes exclusively. No CSS modules, no styled-components, no inline styles.
- Use the `cn()` utility (from `lib/utils.ts`) for conditional class merging.
- All custom colors, fonts, and spacing MUST be defined in `tailwind.config.ts` — never use arbitrary Tailwind values like `text-[#FF5733]` or `p-[13px]`.
- Follow the **8px spacing grid**: 0, 1 (4px), 2 (8px), 3 (12px), 4 (16px), 5 (20px), 6 (24px), 8 (32px), 10 (40px), 12 (48px), 16 (64px), 20 (80px), 24 (96px).

### Images
- ALL images MUST use `next/image` component. Never use raw `<img>` tags.
- LCP images (hero, first product image) MUST have `priority` prop.
- All images MUST have descriptive `alt` text. Never leave `alt=""` on content images.
- Product images MUST use a consistent aspect ratio (3:4 for portraits, 1:1 for grids).
- Use `sizes` prop to prevent downloading oversized images.

### Forms
- All forms use React Hook Form + Zod resolver.
- Inline validation — show errors as user types, not only on submit.
- All form submissions use Server Actions, not API calls.
- Always include loading state on submit buttons.
- Always include error state with user-friendly messages.

---

## 4. Design Philosophy — MUST Follow

### Premium, Not Generic
- Every page must look like it belongs to a **$50M revenue brand**. No generic template aesthetic.
- Use generous whitespace — let products and content breathe.
- Maximum 2 font families per project (1 heading, 1 body).
- Maximum 3 font weights per page (regular, medium, bold).
- Color palette must be curated and harmonious — never use raw Tailwind defaults like `red-500` or `blue-600`. Define semantic tokens in `tailwind.config.ts`.

### Visual Hierarchy
- Every section has one clear focal point. Never compete for attention.
- Primary CTA must be the most visually dominant element in its section.
- Use size AND weight for text hierarchy — never color alone.
- Product images are the hero — everything else supports them.

### Mobile First
- Design for mobile viewport first, then scale up.
- Breakpoints: `sm:640px`, `md:768px`, `lg:1024px`, `xl:1280px`, `2xl:1536px`.
- Touch targets: minimum 44×44px on all interactive elements.
- Thumb-friendly navigation — primary actions within natural thumb reach.
- Bottom sticky CTA bar on mobile for product and cart pages.

### Dark Mode (If Applicable)
- Never use pure `#000000` for dark backgrounds. Use deep charcoal/navy (`#0A0A0A`, `#111827`).
- Never use pure `#FFFFFF` for text on dark. Use off-white (`#F9FAFB`, `#E5E7EB`).
- Glass/blur effects must maintain WCAG AA text contrast ratios.
- Define dark mode tokens in `tailwind.config.ts` using CSS variables.

---

## 4.5 Security & Backend Integration Rules — MUST Follow

### Content Security Policy (CSP) Headers — Third-Party Integration Compliance

**⚠️ CRITICAL:** CSP is enforced in `frontend/next.config.ts` in the `buildSecurityHeaders()` function. Every third-party service (payment gateway, analytics, CAPTCHA, CDN) requires explicit CSP allowlisting OR the browser silently blocks it.

**Current CSP Configuration (frontend/next.config.ts):**

```javascript
// script-src: Controls which scripts can execute
"script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://cdn.razorpay.com https://static.cloudflareinsights.com https://challenges.cloudflare.com"

// frame-src: Controls which iframes can load
"frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://challenges.cloudflare.com"

// connect-src: Controls fetch/WebSocket/etc to external services
"connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com https://cloudflareinsights.com"

// Full policy with all directives in next.config.ts
```

**Currently Allowed Third-Party Services:**
| Service | Purpose | CSP Directives | Status |
|---------|---------|----------------|--------|
| **Razorpay** | Payment gateway | `script-src`, `frame-src`, `connect-src` | ✅ Active |
| **Cloudflare Turnstile** | CAPTCHA/bot prevention | `script-src`, `frame-src` | ✅ Active |
| **Cloudflare Insights** | Analytics beacon | `script-src`, `connect-src` | ✅ Active |

**How to Add a New Third-Party Integration:**

1. **Identify what the service needs** (check service docs):
   - Scripts loaded from CDN? → Add to `script-src`
   - Iframes for UI? (payment, chat, video) → Add to `frame-src`
   - Fetch/API calls? (analytics, webhooks, tracking) → Add to `connect-src`
   - Stylesheets? → Add to `style-src`
   - Images/videos? → Add to `img-src`
   - Fonts from external CDN? → Add to `font-src`

2. **Test locally** with CSP disabled temporarily (or use nonce patterns):
   ```bash
   # In next.config.ts, comment out the CSP headers() to test
   # async headers() { return []; }
   # Then: npm run build && npm run start
   ```

3. **Add the domain to frontend/next.config.ts**:
   ```typescript
   // Example: Adding Google Analytics
   const connectSrc = [
     "'self'",
     apiPublicOrigin || "'self'",
     "https://api.razorpay.com",
     "https://lumberjack.razorpay.com",
     "https://cloudflareinsights.com",
     "https://www.google-analytics.com",  // ← Add here
     "https://www.googletagmanager.com",  // ← Add here
   ].filter(Boolean).join(" ");
   
   const csp = [
     ...
     "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://cdn.razorpay.com https://static.cloudflareinsights.com https://challenges.cloudflare.com https://www.googletagmanager.com",  // ← Add here
     ...
   ].join("; ");
   ```

4. **Commit with CSP domain additions** (separate commit):
   ```bash
   git add frontend/next.config.ts
   git commit -m "fix(csp): allow [Service Name] domains for [Feature Name]"
   ```

5. **Document in this CLAUDE.md** (update the table above) and link from the commit.

6. **Test in production** (VPS):
   ```bash
   # After deployment, check browser DevTools Console for CSP violations:
   # "Executing inline script violates CSP"
   # "Framing ... violates CSP"
   # "Connecting to ... violates CSP"
   ```

**CSP Violations Are Silent Failures:**
- Blocked script → React never hydrates → Add to Cart broken, auth effects don't run
- Blocked iframe → Payment modal never loads, chat widget frozen
- Blocked fetch → Analytics drop silently, user notifications don't send

Always check the **Network** tab (for failed resource loads) and **Console** tab (for CSP violation messages) when adding integrations.

**Rules:**
- ❌ Never use `unsafe-eval` (code injection risk)
- ❌ Never use wildcard `*` in production CSP
- ✅ Keep domains specific and minimal
- ✅ Always test locally AND on VPS before assuming "it works"

**Comprehensive CSP Documentation (June 2026):**
After a production incident where CSP blocking React hydration scripts made the entire site appear broken, detailed documentation was created:

| Document | Purpose | Audience |
|----------|---------|----------|
| `frontend/docs/CSP_QUICK_REFERENCE.md` | 5-step checklist for adding new integrations | Quick lookup for developers |
| `frontend/docs/CSP_AND_THIRD_PARTY_INTEGRATION_GUIDE.md` | Full technical guide: incident analysis, debugging, current services, nonce patterns | Complete reference |
| `frontend/docs/FRONTEND_DEV_LOG.md` §CSP | Development log entry with VPS testing checklist | Session startup |

**When adding a new third-party service:** Start with `frontend/docs/CSP_QUICK_REFERENCE.md`. If you hit CSP violations, refer to the full guide's debugging section.

### XSS Prevention When Rendering Backend Content
- **ALWAYS sanitize** user-generated content (reviews, product descriptions) before rendering
- Use `dangerouslySetInnerHTML` ONLY with DOMPurify or similar sanitization
- Backend already has `additionalProperties: false` on all schemas — leverage this, but still validate on frontend

### API Client Security Patterns
Create a centralized API client (`lib/api.ts`) with these mandatory features:

```typescript
// lib/api.ts — Centralized backend API client
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    // Add credentials for cookie-based auth
    credentials: 'include',
  });

  // Universal response parser (handles both envelope modes)
  const body = await response.json();
  
  if ('success' in body && 'data' in body) {
    if (!body.success) {
      throw new ApiError(body.error?.code, body.error?.message, response.status);
    }
    return body.data as T;
  }
  
  return body as T;
}

// Error class for code-based branching
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
  }
}
```

### Secure Cookie Handling
- Access tokens: Store in **Zustand state** (memory only), never localStorage
- Refresh tokens: Backend handles via HTTP-only cookie (automatic)
- Cart session: Backend manages `cart_session` cookie — frontend just passes it via `credentials: 'include'`

### Checkout Security (CRITICAL)
**Never trust frontend-calculated totals. Always:**
1. Send cart items to backend
2. Backend calculates: subtotal + tax + shipping - discount
3. Display backend-returned totals ONLY
4. Razorpay amount MUST come from backend `/payments/initiate` response

**Forbidden patterns:**
```typescript
// ❌ WRONG — trusting frontend price
const total = cart.items.reduce((sum, item) => sum + (item.price * item.qty), 0);
// ❌ WRONG — hardcoding Razorpay amount
const options = { amount: 50000, ... }; // Never do this
```

**Correct pattern:**
```typescript
// ✅ CORRECT — backend is source of truth for all money
const order = await createOrder(cartItems); // Backend calculates total
const payment = await initiatePayment(order.id); // Backend returns amount + razorpay_order_id
// Use payment.amount and payment.razorpayOrderId for checkout modal
```

### Admin Panel Security (Different from Storefront)
Admin routes MUST implement:
1. **Auth guard** — Check access token exists and is valid
2. **Permission guard** — Check specific permission for action (backend validates, but show/hide UI based on `user.permissions`)
3. **Session timeout warning** — Alert user before token expiry, auto-redirect on 401
4. **Idempotency keys** — REQUIRED for all admin mutations (create product, update inventory, refund order)

Admin-only features to hide from storefront:
- Inventory management
- Order status changes (ship, cancel, refund)
- User management
- Settings/config changes
- Analytics/reports

---

## 4.5 Security Rules for Frontend Implementation

### Token Storage Rules (Enforced)

**Rule 4.5.1: Access tokens in memory only**
```typescript
// ✅ CORRECT — Zustand store, memory only
const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,  // Memory only — lost on refresh
  setAccessToken: (token) => set({ accessToken: token }),
}));

// ❌ FORBIDDEN — never use localStorage for tokens
localStorage.setItem('accessToken', token);  // NEVER DO THIS
```

**Rule 4.5.2: Refresh tokens are httpOnly cookie — frontend does not touch them**
- Refresh happens via automatic 401 → refresh → retry flow
- Frontend never reads, writes, or stores refresh tokens
- Logout calls endpoint: `POST /api/v1/auth/logout` (backend clears cookie)

**Rule 4.5.3: Ops session is cookie-only — no headers to set**
- Ops requests automatically include `ops_session` cookie via `credentials: 'include'`
- Never add `Authorization` header for ops routes
- Never add `x-ops-key-id` or `x-ops-api-key` headers (these do not exist)

### Authentication Implementation Patterns

**Pattern: Customer Auth (JWT in memory + refresh cookie)**
```typescript
// 1. Login sends OTP
await api.post('/auth/send-otp', { phone });

// 2. Verify OTP gets access token
const { accessToken } = await api.post('/auth/verify-otp', { phone, otp });
useAuthStore.getState().setAccessToken(accessToken);  // Memory only

// 3. All requests use token from store
api.get('/users/me', {
  headers: { Authorization: `Bearer ${useAuthStore.getState().accessToken}` }
});

// 4. 401 handler refreshes automatically
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.status === 401) {
      await api.post('/auth/refresh');  // Cookie sent automatically
      const newToken = useAuthStore.getState().accessToken;
      return api.request({ ...err.config, headers: { ...err.config.headers, Authorization: `Bearer ${newToken}` } });
    }
    throw err;
  }
);
```

**Pattern: Admin Auth (2-step OTP → JWT)**
```typescript
// Step 1: Request OTP with credentials — advance to OTP UI only on 200
try {
  const { expiresAt } = await api.post('/auth/admin/login/request-otp', { email, password });
  setStep('otp');
  setExpiresAt(expiresAt);
} catch (err) {
  if (err.code === 'INVALID_CREDENTIALS') {
    // Known admin, wrong password — stay on credentials; show "Incorrect password."
  } else if (err.code === 'UNAUTHORISED') {
    // Deactivated admin (isBanned) — stay on credentials
  }
  // Unknown email may still get 200 generic without OTP (anti-enumeration)
}

// Step 2: Verify OTP
const { accessToken, admin } = await api.post('/auth/admin/login/verify-otp', { email, otp });
useAuthStore.getState().setAccessToken(accessToken);
useAuthStore.getState().setAdmin(admin);  // Includes permissions array

// Step 3: Permission-aware UI
const canEditProducts = admin.permissions.includes('products:write');
{canEditProducts && <Button>Edit Product</Button>}
```

**Admin form validation (2026-06-06):** Merchant write forms use `useAdminFormValidation()` from `frontend/hooks/use-admin-form-validation.ts`. Inputs carry `data-admin-field="<key>"`; error state uses `!border-destructive` via `fieldClassName()`. On `VALIDATION_ERROR`, parse `error.details.fields`, highlight inputs, scroll/focus first error, and append field summaries in the banner (`formatAdminValidationSummary`). Product create requires **Category** + **URL Slug** (`AdminProductEditor`). Canonical spec: `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §2.1.1; dev log: `frontend/docs/FRONTEND_DEV_LOG.md` §2026-06-06.

**Pattern: Ops Auth (Browser session cookie)**
```typescript
// Step 1: Request OTP
await api.post('/ops/auth/login/request-otp', { email, password });

// Step 2: Verify OTP — cookie set automatically
const { opsUserId, permissions } = await api.post('/ops/auth/login/verify-otp', { email, otp });
// No token to store — cookie handles everything

// Step 3: All ops requests use credentials: 'include'
await api.get('/ops/config/overview', { credentials: 'include' });
```

### OTP Challenge Implementation (5 Critical Ops Operations)

**Rule 4.5.4: All critical ops mutations require 2-step OTP flow**

Affected endpoints:
- `POST /ops/config/save`
- `POST /ops/load-shed`
- `POST /ops/system/restart`
- `POST /ops/users/:id/deactivate`
- `POST /ops/invites/:id/revoke`

**Required Pattern:**
```typescript
// Component: CriticalOpsAction.tsx
function CriticalOpsAction({ action, onExecute, buttonText }) {
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);

  const handleInitiate = async () => {
    // Step 1: Request OTP challenge (body field is `action`, not actionType)
    const { challengeId, expiresAt } = await api.post('/ops/otp/request', { action });
    setChallengeId(challengeId);
    setExpiresAt(new Date(expiresAt));
    setShowOtpModal(true);
  };

  const handleVerifyAndExecute = async (otpCode: string) => {
    // Step 2: Execute with challengeId + otpCode
    await onExecute({ challengeId, otpCode });
    setShowOtpModal(false);
  };

  return (
    <>
      <Button onClick={handleInitiate}>{buttonText}</Button>
      {showOtpModal && (
        <OtpModal
          expiresAt={expiresAt}
          onSubmit={handleVerifyAndExecute}
          onCancel={() => setShowOtpModal(false)}
        />
      )}
    </>
  );
}

// Usage for system restart
<CriticalOpsAction
  action="system-restart"
  buttonText="Schedule Restart"
  onExecute={({ challengeId, otpCode }) =>
    api.post('/ops/system/restart', { delayMinutes: 5, challengeId, otpCode })
  }
/>
```

**Rule 4.5.5: OTP modal must show countdown and handle errors**
```typescript
function OtpModal({ expiresAt, onSubmit, onCancel }) {
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState(5);

  // Countdown timer
  const secondsRemaining = useCountdown(expiresAt);

  const handleSubmit = async () => {
    try {
      await onSubmit(otp);
    } catch (err: any) {
      if (err.code === 'UNAUTHORISED') {
        setAttemptsRemaining(prev => prev - 1);
        setError(`Invalid OTP. ${attemptsRemaining - 1} attempts remaining.`);
      } else if (err.code === 'RATE_LIMIT_EXCEEDED') {
        setError('Too many attempts. Please wait before retrying.');
      } else if (err.code === 'OPS_AUDIT_CHAIN_LOCK_TIMEOUT') {
        setError('System busy. Retrying...');
        setTimeout(() => handleSubmit(), 1500);  // Auto-retry after 1.5s
      }
    }
  };

  if (secondsRemaining <= 0) {
    return <div>OTP expired. Please request a new one.</div>;
  }

  return (
    <Modal>
      <div>Enter OTP (expires in {secondsRemaining}s)</div>
      <Input value={otp} onChange={setOtp} maxLength={6} />
      {error && <Alert>{error}</Alert>}
      <Button onClick={handleSubmit}>Verify & Execute</Button>
      <Button variant="ghost" onClick={onCancel}>Cancel</Button>
    </Modal>
  );
}
```

### SMS Provider Selection

**Rule 4.5.7: Support all three SMS providers with proper fallback handling**

The backend supports three SMS providers via the `SMS_PROVIDER` environment variable:

1. **MSG91** (`msg91`) - Primary provider with template-based SMS
2. **Fast2SMS** (`fast2sms`) - Alternative provider with direct API
3. **Noop** (`noop`) - Development/testing mode (no actual SMS sent)

**Frontend Implementation Pattern:**
```typescript
// lib/sms-client.ts
interface SmsProvider {
  sendOtp(phone: string, otp: string): Promise<void>;
  resendOtp(phone: string): Promise<void>;
}

// Provider detection based on backend config
const detectSmsProvider = async (): Promise<'msg91' | 'fast2sms' | 'noop'> => {
  const { data: { config } } = await api.get('/ops/config/sms-provider');
  return config.SMS_PROVIDER;
};

// Usage in auth flows
const smsProvider = await detectSmsProvider();
switch (smsProvider) {
  case 'msg91':
    await msg91Client.sendOtp(phone, otp);
    break;
  case 'fast2sms':
    await fast2SmsClient.sendOtp(phone, otp);
    break;
  case 'noop':
    console.log('Development mode: OTP would be sent to', phone);
    // Show OTP in UI for testing in noop mode
    setDevOtp(otp);
    break;
}
```

**UI Considerations:**
- In `noop` mode, display the OTP in the UI for testing
- Show provider-specific delivery status messages
- Handle rate limits per provider (MSG91: 10/min, Fast2SMS: 5/min)
- Implement proper error handling for provider-specific failures

### Meta WhatsApp Integration

**Rule 4.5.8: WhatsApp is separate from SMS provider selection**

Meta WhatsApp uses the Cloud API and is controlled by `NOTIFY_WHATSAPP_ENABLED` in the backend:

**WhatsApp Features:**
- 2-way customer communication (order updates, support)
- Template-based messages for notifications
- Interactive buttons for quick actions
- Separate from SMS provider (can be enabled with any SMS provider)

**Frontend Integration Pattern:**
```typescript
// lib/whatsapp-client.ts
interface WhatsAppClient {
  sendTemplateMessage(to: string, templateName: string, variables: Record<string, string>): Promise<void>;
  markAsRead(messageId: string): Promise<void>;
  sendInteractiveMessage(to: string, message: string, buttons: string[]): Promise<void>;
}

// Check WhatsApp availability
const isWhatsAppEnabled = async (): Promise<boolean> => {
  const { data: { config } } = await api.get('/ops/config/whatsapp');
  return config.NOTIFY_WHATSAPP_ENABLED;
};

// Usage in order updates
if (await isWhatsAppEnabled()) {
  await whatsappClient.sendTemplateMessage(
    customer.phone,
    'order_confirmation',
    { order_id: order.id, total: formatPrice(order.total) }
  );
}
```

**UI Components for WhatsApp:**
- Chat interface for customer conversations
- Message templates management (admin only)
- Delivery status indicators
- Interactive button responses

### CSP Compliance Rules

**Rule 4.5.9: No inline styles — all CSS in external files**
```tsx
// ✅ CORRECT — Tailwind classes
<div className="p-4 bg-white rounded-lg shadow-md">

// ❌ FORBIDDEN — inline styles (violates CSP)
<div style={{ padding: '16px', backgroundColor: 'white' }}>
```

**Rule 4.5.7: No inline scripts — all JS in external files**
```tsx
// ✅ CORRECT — event handlers in component
<button onClick={handleClick}>Click</button>

// ❌ FORBIDDEN — inline script (violates CSP)
<button onClick="alert('hello')">Click</button>
// ❌ FORBIDDEN — dangerouslySetInnerHTML with scripts
<div dangerouslySetInnerHTML={{ __html: '<script>...</script>' }}>
```

**Rule 4.5.8: No eval() or new Function() with user input**
```typescript
// ❌ FORBIDDEN — code injection risk
const fn = new Function(userInput);

// ✅ CORRECT — use safe alternatives
const value = JSON.parse(userInput);  // With try/catch and validation
```

### Error Handling Rules

**Rule 4.5.9: Branch on error.code only — never parse error.message**
```typescript
// ✅ CORRECT
if (error.code === 'UNAUTHORISED') {
  redirect('/login');
} else if (error.code === 'RATE_LIMIT_EXCEEDED') {
  showToast('Please slow down and try again.');
} else if (error.code === 'FORBIDDEN') {
  showToast('You do not have permission for this action.');
}

// ❌ FORBIDDEN — messages change, codes are stable
if (error.message.includes('unauthorized')) { ... }
if (error.message.includes('rate limit')) { ... }
```

**Rule 4.5.10: Generic error messages to users — no stack traces**
```typescript
// ✅ CORRECT — user sees generic message
showToast('An error occurred. Please try again.');
console.error('Full error:', error);  // Detailed log for dev only

// ❌ FORBIDDEN — exposes implementation details
showToast(error.stack);
showToast(`Database connection failed: ${error.message}`);
```

### Permission-Based UI Rules

**Rule 4.5.11: Hide/disable UI based on permissions — backend validates anyway**
```typescript
// ✅ CORRECT — proactive UI + backend validation
type AdminPermissions =
  | 'products:read' | 'products:write'
  | 'orders:read' | 'orders:write' | 'orders:refund'
  | 'coupons:read' | 'coupons:write'
  | 'users:read' | 'users:write'
  | 'settings:read' | 'settings:write'
  | 'analytics:read' | 'queues:inspect';

function AdminLayout() {
  const { admin } = useAuthStore();
  const hasPermission = (perm: AdminPermissions) =>
    admin?.permissions?.includes(perm) ?? false;

  return (
    <nav>
      {hasPermission('products:read') && <Link to="/products">Products</Link>}
      {hasPermission('orders:read') && <Link to="/orders">Orders</Link>}
      {hasPermission('coupons:read') && <Link to="/coupons">Coupons</Link>}
      {hasPermission('queues:inspect') && <Link to="/queues">Queue Monitor</Link>}
    </nav>
  );
}

// Buttons disable if no write permission
<Button disabled={!hasPermission('products:write')}>
  Create Product
</Button>
```

**Rule 4.5.12: Ops has only 2 permissions — no OPS_APPROVE**
```typescript
type OpsPermission = 'ops:read' | 'ops:write';  // Only these two

// ✅ CORRECT — check ops permissions
function OpsLayout() {
  const { permissions } = useOpsStore();
  const canWrite = permissions.includes('ops:write');

  return (
    <nav>
      <Link to="/ops/config">Config</Link>
      {canWrite && <Link to="/ops/config/edit">Edit Config</Link>}
    </nav>
  );
}

// ❌ FORBIDDEN — OPS_APPROVE does not exist
const needsApproval = permissions.includes('OPS_APPROVE');  // NEVER DO THIS
```

### Secret Masking Rules

**Rule 4.5.13: Never show plaintext secrets in UI — always mask**
```typescript
// ✅ CORRECT — show masked values
function ConfigValue({ value, isSecret }) {
  if (isSecret) {
    return <code>••••••••••••••••</code>;
  }
  return <code>{value}</code>;
}

// For ops config — always masked
function OpsConfigRow({ configKey }) {
  return (
    <tr>
      <td>{configKey.key}</td>
      <td>••••••••••••••••</td>  {/* Never show plaintext */}
      <td>{configKey.requiresRestart && 'Restart Required'}</td>
    </tr>
  );
}

// ❌ FORBIDDEN — never expose secrets
<div>API Key: {apiKey}</div>
<input value={secretKey} />  {/* Even in password input, don't show */}
```

### Webhook Boundary Rule

**Rule 4.5.14: Browser NEVER calls webhook endpoints**
```typescript
// ❌ FORBIDDEN — webhooks are server-only
await api.post('/payments/webhook', { ... });  // NEVER FROM BROWSER
await api.post('/shipping/webhook', { ... });  // NEVER FROM BROWSER

// ✅ CORRECT — browser uses customer-facing endpoints
await api.post('/payments/verify', { orderId, paymentId });  // For customers
await api.get('/orders/:id/tracking');  // For customers
```

### Session Timeout Handling

**Rule 4.5.15: Handle 401 with auto-refresh or redirect**
```typescript
// Pattern: Auto-refresh on 401, redirect if refresh fails
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalRequest = err.config;

    if (err.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Attempt refresh — cookie sent automatically
        await api.post('/auth/refresh');
        // Retry original request
        return api(originalRequest);
      } catch (refreshErr) {
        // Refresh failed — redirect to login
        window.location.href = '/login';
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(err);
  }
);
```

### Summary: Security Checklist for Frontend Builds

Before shipping any auth/ops/admin feature:

- [ ] Access tokens in Zustand memory (not localStorage)
- [ ] Refresh tokens handled via httpOnly cookies only
- [ ] 401 → refresh → retry flow implemented
- [ ] 5 critical ops operations have OTP modal (config-save, load-shed, system-restart, user-deactivate, invite-revoke)
- [ ] OTP modal shows 5-minute countdown and remaining attempts
- [ ] 503 ops_audit_chain_lock_timeout handled with 1-2s retry
- [ ] No inline styles (CSP compliance)
- [ ] No inline scripts (CSP compliance)
- [ ] Error branching uses `error.code` not `error.message`
- [ ] Generic error messages shown to users (no stack traces)
- [ ] Secrets masked in UI (••••••••)
- [ ] Permission-based UI hide/disable implemented
- [ ] No webhook calls from browser code

---

## 5. Performance Rules — MUST Follow

### Core Web Vitals Targets
| Metric | Target | How |
|--------|--------|-----|
| **LCP** | < 2.5s | `priority` on hero/first image, streaming with Suspense |
| **INP** | < 200ms | Minimal client JS, optimistic updates, no heavy re-renders |
| **CLS** | < 0.1 | All images/embeds have explicit dimensions, skeleton loaders |

### Rendering Strategy
- **Static (SSG):** Homepage, category pages, CMS pages — use `generateStaticParams()`.
- **ISR:** Product pages — `revalidate: 3600` (1 hour) or on-demand with `revalidateTag()`.
- **Dynamic (SSR):** Cart, checkout, account pages — user-specific data.
- **Client:** Mini-cart sheet, search autocomplete, modals — interactive UI only.

### Bundle Optimization
- Every route segment MUST have a `loading.tsx` for streaming.
- Lazy load below-the-fold sections with `React.lazy()` or dynamic imports.
- Never import entire libraries — use tree-shakeable named imports.
- Audit bundle with `@next/bundle-analyzer` before every major release.
- Third-party scripts (analytics, chat widgets) load via `next/script` with `strategy="lazyOnload"`.

### Image Optimization
```tsx
// ✅ CORRECT — proper sizing, priority for LCP
<Image
  src={product.images[0].url}
  alt={product.images[0].alt}
  width={600}
  height={800}
  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
  priority={isAboveFold}
  className="object-cover"
/>

// ❌ WRONG — no sizes, no priority consideration, fill without container
<Image src={url} alt="" fill />
```

---

## 6. Conversion Optimization Rules

### Every Product Page MUST Include (Above the Fold)
- [ ] High-quality product image (zoomable)
- [ ] Product name as `<h1>`
- [ ] Price (with strikethrough discount if applicable)
- [ ] Star rating + review count (clickable, links to reviews section)
- [ ] Variant selectors (size, color) as visual swatches
- [ ] "Add to Cart" primary CTA button (large, high contrast)
- [ ] Trust signal (free shipping/easy returns/secure checkout)

### Checkout MUST Include
- [ ] Guest checkout option (no forced registration)
- [ ] Address autocomplete
- [ ] Inline form validation with Zod
- [ ] Transparent pricing — show total with tax/shipping BEFORE payment
- [ ] Progress indicator
- [ ] Trust badges near payment section
- [ ] Persistent order summary (sticky on desktop)
- [ ] Payment method selector: show "Pay Online" (Razorpay) and "Cash on Delivery" options; hide COD if `isCodEnabled` is `false` (check `GET /api/v1/admin/settings/cod` via a public store-info endpoint or feature flag)
- [ ] **Send `idempotency-key` header** on `POST /api/v1/orders`, `POST /api/v1/payments/initiate`, and `POST /api/v1/payments/verify` (see Backend Contract §4)
- [ ] For COD orders: call `POST /api/v1/orders` with `{ paymentMode: 'COD' }` — skip Razorpay modal entirely; order confirmation screen is shown immediately
- [ ] For PREPAID orders: complete full flow — `/orders` → `/payments/initiate` → Razorpay modal → `/payments/verify` (see Backend Contract §5)
- [ ] For prepaid retry: `POST /api/v1/payments/retry` to get a new `razorpay_order_id`, then reopen Razorpay modal
- [ ] Never call `/payments/webhook` from browser (server-only endpoint per Backend Contract §6)

### Urgency & Social Proof
- Show "Only X left in stock" when inventory < 5.
- Show review count and rating near price on every product card.
- Show "X people bought this recently" where data is available.
- Display trust badges (secure checkout, free returns) near all CTA buttons.

### Anti-Abandonment
- Cart data persists in Zustand + localStorage across sessions (good UX — cart is not sensitive).
- **Auth tokens NEVER persist in localStorage** — memory only (see §4.5 Security Model).
- Sticky mobile bottom bar with price + CTA on product and cart pages.
- Use optimistic updates (`useOptimistic`) for cart quantity changes.
- Use skeleton screens, never loading spinners.

---

## 7. SEO Rules — MUST Follow

### Every Page Needs
- Dynamic `metadata` export with unique `title` and `description`.
- Proper `<h1>` — only ONE per page, descriptive and keyword-rich.
- Logical heading hierarchy: `h1` → `h2` → `h3` (no skipping levels).
- Semantic HTML5 elements: `<main>`, `<nav>`, `<article>`, `<section>`, `<aside>`.
- Canonical URL via `alternates.canonical` in metadata.

### Product Pages Need
- JSON-LD `Product` structured data (name, price, availability, rating, image).
- JSON-LD `BreadcrumbList` structured data.
- Dynamic OG image (product photo) via `openGraph.images` in metadata.
- `generateStaticParams()` for all known product slugs.

### Category Pages Need
- JSON-LD `CollectionPage` or `ItemList` structured data.
- Pagination with `rel="next"` and `rel="prev"` or infinite scroll with proper URL handling.

---

## 8. Accessibility (a11y) — MUST Follow

- All interactive elements MUST have descriptive `aria-label` attributes.
- All form inputs MUST have associated `<label>` elements (not just placeholder text).
- Focus indicators MUST be visible on all focusable elements (use `focus-visible:ring-2`).
- Color MUST NOT be the only way to convey information (add icons/text alongside).
- All text MUST meet WCAG AA contrast ratio: 4.5:1 for body text, 3:1 for large text and UI.
- The entire site MUST be navigable via keyboard (Tab, Enter, Escape, Arrow keys).
- Dynamic content changes MUST be announced to screen readers (`aria-live` regions).
- Modal/Sheet components MUST trap focus and return focus on close.
- `prefers-reduced-motion` media query MUST be respected — disable animations for users who prefer it.

---

## 9. Backend API Integration

### Mandatory delivery model: simultaneous build + integration

Do **not** build all pages/screens first and integrate API calls later. Build each capability as a **contract-first vertical slice**:

1. Freeze the route contract and request/response schema for the slice.
2. Implement typed API client methods for the slice endpoints.
3. Build UI states: `loading`, `empty`, `error`, `success`.
4. Integrate with real backend routes (never close a slice with mocks only).
5. Verify permissions (proactive UI hide/disable + backend `401/403` handling) and idempotency behavior.
6. Close the slice only when integration + UI interaction tests pass.

Required delivery sequence (6 tiers, strict order):

1. **Foundation** — auth bootstrap, refresh-on-401, shared API client, dual-envelope response parser, `error.code` mapper, permission-aware nav scaffold, Zustand stores (auth + cart).
2. **Ops control plane surfaces** — public routes `/ops/login` and `/ops/setup` only (no console nav); all other `/ops/*` routes gated by `GET /ops/session` with redirect to login on `401`; session bootstrap (`GET /ops/session`), load-shed change including the new `maintenance` mode (`POST /ops/load-shed` — applies immediately with OTP confirmation; `maintenance` writes a durable Postgres-backed row that survives Redis flushes and starts a 2-min `pending` warning before Nginx serves the static maintenance page for non-ops routes), audit timeline, config overview/stored/save screens with masked values only.
3. **Admin read surfaces** — dashboard KPIs/charts, orders list/detail + return request queue + return request detail (`GET /admin/return-requests/:id`), global shipments (`GET /admin/shipments`, `shipments:read`) + global payments (`GET /admin/payments`, `payments:read`), inventory list + adjustment history per variant (`GET /admin/inventory/history/:variantId`), product list + categories, customer index + CRM view (customer detail includes ban fields `isBanned`/`bannedAt`/`bannedReason`; paginated order tab via `GET /admin/users/:id/orders`; admin notes list `GET /admin/users/:id/notes`), review moderation queue. Build before mutations so you have real data to validate against.
4. **Admin mutation surfaces** — ship action (run shipping provider dry-run simultaneously), Razorpay PREPAID checkout (run Razorpay test payment dry-run simultaneously), COD checkout, cancel/refund (async — UI must show pending-refund state until worker finalises), COD collection, return request approve/reject (`PATCH /admin/return-requests/:id`), stock adjustment + bulk stock update (`POST /admin/inventory/bulk-update`, max 100 variants, full rollback on any failure), product deactivate (`DELETE /admin/products/:id` — UI label **Deactivate**) + permanent delete (`DELETE /admin/products/:id/permanent` via `AdminRowActionsMenu`; **409** if orders/reviews), product variant delete (`DELETE /admin/products/:id/variants/:variantId` — disabled in UI if last variant; backend returns 400), review hard-delete (`DELETE /admin/reviews/:id`, destructive confirmation required), customer ban (`PATCH /admin/users/:id/ban`, `users:write`, mandatory reason) + unban (`DELETE /admin/users/:id/ban`), admin notes create/delete (`POST`/`DELETE /admin/users/:id/notes`, `users:write`), settings (shipping/store/inventory/cod — notifications provider config is ops-only via `/ops/config`; admin notifications UI removed 2026-06-07), coupon lifecycle (create → edit → pause/resume → soft-delete → restore; clone via `POST .../coupons/:id/clone`; audit log per coupon via `GET .../coupons/:id/audit`; handle `RATE_LIMIT_EXCEEDED` 429 gracefully on write actions; `BUY_X_GET_Y` type hidden in forms until v2.2; deleted coupons remain visible in list with restore action — hard delete does not exist).
5. **Reliability surfaces** — reconciliation issues, outbox dead-letter list + replay-preview + replay, inbox failures + replay-preview + replay, analytics (revenue, funnel, category breakdown, inventory alerts, notification delivery), Bull Board queue visibility.
6. **Storefront customer journey surfaces** — catalogue (product list/detail/categories/search), cart (guest session + merge-on-login + coupon + pincode check + **`paymentMode` on delivery rates**), PREPAID checkout (full Razorpay sequence), COD checkout (gate on **`GET /store/config`.isCodEnabled**), order history/detail/tracking (cancel only **CONFIRMED/PROCESSING**; invoice CTA on **`invoice.hasPdf`**; retry payment single-call on payment page), customer auth (OTP + email + forgot-password + refresh loop + logout), user profile + addresses. Module flags via **`useStoreConfig()`** — not `NEXT_PUBLIC_FEATURE_*`. Run Resend email dry-run during checkout slice.

Non-negotiable boundaries:
- Merchant operations stay on `/api/v1/admin/*`. Platform controls stay on `/api/v1/ops/*`.
- Never proxy merchant actions through ops APIs to simplify UI.
- Never persist raw ops credentials in browser storage or URLs.
- Ops load-shed change is a single-step action: `POST /ops/load-shed` applies immediately after OTP confirmation. There is no approval queue or separate confirm/reject step. The mode enum is `normal | reduced | emergency | maintenance`. The response carries `{ mode, updated, phase, pendingUntil }` — `phase` is non-null only when `mode === 'maintenance'` (`pending` during the 2-minute warning, `active` after the cutover).
- **Global storefront maintenance banner:** A `MaintenanceBanner` client component must be mounted in the root layout (`app/layout.tsx`). It polls `GET /api/v1/maintenance/status` (public, rate-limit-exempt) every 10 s normally and every 5 s during `maintenance/pending`, renders a countdown to `pendingUntil` aligned with the server clock (use `status.serverTime`, never `Date.now()` alone), **does not poll on `/admin/*` or `/ops/*`**, and renders nothing while mode is `normal | reduced | emergency`. The banner is mandatory on all customer-facing surfaces — without it, the only warning shoppers get during the 2-minute window is a sudden 503 from Nginx.
- Authoritative reference for what each admin/ops route does, what permission it requires, and what each layer cannot do: `docs/ROUTE_SURFACE_COMPLETE_REFERENCE.md`.
- Invoice CTA state must use `invoice.hasPdf` only; never derive from guessed URL fields.
- Invoice downloads are authenticated backend routes only:
  - Customer: `GET /api/v1/orders/:id/invoice.pdf`
  - Admin: `GET /api/v1/admin/orders/:id/invoice.pdf`
- Ops config screens must render contract metadata (`mutableViaOps`, `requiresRestart`, `runtimeSource`) and never reveal plaintext secret values.
- `DATABASE_URL`, initial `REDIS_URL`, and `OPS_DB_ENCRYPTION_KEY` are bootstrap-only; render them as read-only if visible and route operators to deployment env changes.
- DB-overlay eligible Ops config keys must show restart-required behavior: saved values are encrypted, override env only for non-bootstrap contract keys, and take effect only after API/worker restart.
- `/admin/setup` must consume invite tokens only through `POST /api/v1/admin/invites/consume`; never persist invite tokens in browser storage or expose ops/developer permissions in merchant admin setup.
- `POST /api/v1/admin/invites` and cleanup are ops-authenticated Layer C actions; do not expose invite creation/cleanup inside merchant admin self-service screens.

Per-slice test gate (required before closing):
- one route-level integration test against the real backend module (not mocked),
- one permission negative test (`401/403` handling; proactive UI hide/disable verified),
- one idempotency/retry test for critical writes,
- one UI interaction test (happy path + primary failure path).

At every 4–6 slices milestone: run full `docs/BACKEND_GO_LIVE_CHECKLIST.md` and re-check BRD AC coverage (`docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §12.2).

Reference: `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §1.2 and `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`.

### Full-stack co-development operating mode (mandatory)

- Treat frontend + backend as one delivery stream for each slice: do not defer backend fixes.
- When a backend gap appears during slice work:
  1. Implement the backend fix in the template codebase.
  2. Add/adjust regression tests and relevant docs in the same change.
  3. Resume frontend slice integration only after backend contract is stable.
- Every backend change discovered from frontend work must be classified as:
  - **Template-worthy** (propagate to template repo), or
  - **Client-specific** (keep out of template baseline).
- Never push automatically: propose the push/PR steps and require explicit user approval for any remote mutation.

---

### API Client (`lib/api.ts`)
- Centralized fetch wrapper is mandatory and must implement:
  - canonical base URL from `NEXT_PUBLIC_API_BASE_URL`
  - dual success parsing (enveloped/raw)
  - auth token/cookie handling
  - error branching by `error.code`
  - idempotency-key injection for critical writes
- Use the canonical implementation pattern from section `4.5` and `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` instead of duplicating variants.

### Money Display
- Backend stores money as `Int` (paise). Frontend MUST divide by 100 for display.
- Use a shared `formatPrice()` utility:
```tsx
export function formatPrice(paise: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
  }).format(paise / 100);
}
```
- **NEVER** do math on displayed prices. Always work with paise integers.

### Backend Architecture Notes (Behavioral Context)

These backend characteristics affect frontend behavior understanding. No code changes needed, but be aware:

**Circuit Breaker Scope (Process-Local)**
- Payment and shipping provider circuit breakers are **process-local** on the backend
- Each backend replica maintains its own circuit state — NOT shared across replicas via Redis
- **Frontend implication:** If backend instance A has a payment provider circuit OPEN (failing), instance B may still have it CLOSED. Retries may succeed on different instances. Backend handles this; frontend should still implement exponential backoff on 503/504 errors.

**Prisma Delegate Drift Guard**
- Backend CI runs `prisma:generate:safe` to detect Prisma delegate drift (schema vs client mismatch)
- **Frontend implication:** If backend deployments fail due to drift, API contracts may be unstable. Verify backend health before frontend integration work.

**Ops Config Hybrid Runtime Model**
- **Bootstrap-only keys** (never from DB): `DATABASE_URL`, initial `REDIS_URL`, `OPS_DB_ENCRYPTION_KEY`
- **DB-overlay eligible keys:** Non-bootstrap contract-allowed mutable keys stored encrypted in `OpsConfigSecret`
- **Restart behavior:** DB-overlay config changes require API/worker restart to take effect
- **Frontend implication:** If admin changes payment provider credentials via Ops UI, a backend restart is required. Show "Restart Required" UI state when `requiresRestart: true` in config metadata.

**Deferred REFUNDED Async Lifecycle**
- Admin-triggered `REFUNDED` status updates are **asynchronous** via queue/provider confirmation
- Do not assume immediate order status flip in the same response
- **Frontend implication:** UI must expose "Refund Pending" progression state. Poll order status or use WebSocket (if implemented) to detect final `REFUNDED` state.

**Admin Permission Token-Snapshot Behavior**
- Admin permissions are embedded in the access token at issuance (snapshot)
- Mid-window grant/revoke changes require token refresh or logout/re-auth to take effect
- **Frontend implication:** After admin permission changes, force token refresh or redirect to login. Do not assume immediate UI permission changes.

**Idempotency Key Collisions**
- Backend now uses atomic CAS patterns for idempotency — concurrent identical idempotency keys result in one execution, others return cached response (no double-charge)
- **Frontend implication:** Safe to retry with same key on 503/504 errors; only generate fresh UUIDs for genuinely new user actions, not retries

**Ops Audit Chain Lock Contention**
- Under high concurrent ops activity, ops write endpoints may return `503 ops_audit_chain_lock_timeout`
- **Frontend implication:** Treat as retryable after 1–2 second backoff; do not treat as failure

---

## 10. Micro-Interactions & Animations

### Rules
- All animations MUST use Framer Motion (never CSS `@keyframes` for complex interactions).
- Maximum animation duration: 500ms. Most interactions should be 200–300ms.
- Use `ease-out` for entrances, `ease-in` for exits.
- Only animate GPU-accelerated properties: `transform` and `opacity`.
- Use `will-change` sparingly and only during active animations.
- MUST respect `prefers-reduced-motion` — wrap in Framer Motion's `useReducedMotion()`.

### Standard Animations
| Element | Animation | Duration |
|---------|-----------|----------|
| Page entrance | Fade in + slide up (y: 20→0) | 400ms |
| Product card hover | Image scale (1→1.05) + shadow elevation | 300ms |
| Add to cart click | Button pulse (1→0.95→1) + cart badge spring | 200ms |
| Modal/Sheet open | Fade in backdrop + slide in content | 300ms |
| Toast notification | Slide in from top-right + auto-dismiss | 300ms in, 5s display |
| Skeleton loader | Shimmer gradient sweep | 1.5s loop |
| Section scroll-in | Fade + stagger children by 100ms | 400ms per item |

---

## 11. Environment Variables

### Required (`.env.local`)
```bash
# Backend API
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1

# Site
NEXT_PUBLIC_STOREFRONT_URL=http://localhost:3101
NEXT_PUBLIC_STORE_NAME="Acme Store"

# Analytics (production only)
NEXT_PUBLIC_GA_ID=
NEXT_PUBLIC_GTM_ID=

# Payment (if client-side tokenization needed)
NEXT_PUBLIC_RAZORPAY_KEY_ID=

# Image CDN — must match backend MEDIA_CDN_BASE_URL; proxies /api/v1/media/products/*
NEXT_PUBLIC_IMAGE_CDN_URL=
```

### Rules
- All client-exposed env vars MUST start with `NEXT_PUBLIC_`.
- Server-only secrets (API keys, webhook secrets) MUST NOT start with `NEXT_PUBLIC_`.
- Create `.env.example` with all variables documented.
- **NEVER** commit `.env.local` to git.
- Keep `frontend/.env.production.example` committed as the canonical VPS production template (required by Phase 10 scripts).
- Frontend secret handling must follow `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md`.

### Production VPS (`.env.production.local`)
- Copy from template: `cp .env.production.example .env.production.local`
- Must include: `CLIENT_ID`, `STOREFRONT_PORT`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_STOREFRONT_URL`, `NEXT_PUBLIC_RAZORPAY_KEY_ID`, `INTERNAL_API_BASE_URL`
- `NEXT_PUBLIC_API_BASE_URL` must use production HTTPS domain and include `/api/v1` (never localhost)
- On shared VPS, set `OPS_UI_BASIC_AUTH_USERNAME` and `OPS_UI_BASIC_AUTH_PASSWORD` so `/ops/*` does not fail closed with 503 in production-like runtime

---

## 11.5 Testing & Full-Stack Validation — MUST Follow

### Testing Pyramid (Priority Order)

1. **Static Analysis** (fast, every save)
   - `npm run typecheck` — Zero TypeScript errors
   - `npm run lint` — Zero ESLint warnings
   - `npm run build` — Successful production build

2. **Unit Tests** (business logic, utilities)
   - Test pure functions (price calculations, date formatting, validators)
   - Test Zustand store logic (cart operations, auth state)
   - Never test implementation details — test behavior

3. **Integration Tests** (API client, backend contract)
   - Test `lib/api.ts` against real backend (not mocks)
   - Test error handling paths (401, 403, 500, network failure)
   - Test idempotency key generation for mutations
   - Test envelope/raw response parsing

4. **E2E Tests** (critical user journeys)
   - Full checkout flow (PREPAID and COD)
   - Auth flows (login, register, forgot password, token refresh)
   - Admin mutations (create product, update order status)

### Pre-Development Backend Verification Checklist

Before writing ANY frontend code that calls the backend:

| Check | How | If Failing |
|-------|-----|------------|
| Backend running | `curl http://localhost:3000/api/v1/health` | Start `npm run dev:e2e` + workers |
| DB connected | Health response shows `"db":"connected"` | Fix per `docs/MASTER_DEPLOYMENT_PLAYBOOK.md` Appendix H.4 |
| Redis connected | Health response shows `"redis":"connected"` | Check `REDIS_PASSWORD` not blank, wipe container if needed |
| Migrations current | `npx prisma migrate status` (local) | Local: `npm run dev:e2e` or `npx prisma migrate deploy`. **VPS host:** never bare migrate when `.env` uses `host.docker.internal` — use `DATABASE_URL` with `127.0.0.1` override or `scripts/vps-deploy.sh` (`CLIENT_VPS_SETUP_GUIDE.md` §9) |
| Feature flags known | Ask user which are enabled | Backend `.env` must have `FEATURE_*` values |
| Postman E2E passed | Run folders 0→1→2→3 | Debug failures before frontend integration |

### Integration Test Template (`lib/api.test.ts`)

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { apiClient, ApiError } from './api';

// These tests run against real backend — no mocks
describe('API Client Integration', () => {
  beforeAll(async () => {
    // Verify backend is running
    const health = await apiClient('/health');
    expect(health.status).toBe('ok');
  });

  it('handles enveloped success response', async () => {
    // If FEATURE_RESPONSE_ENVELOPE_ENABLED=true
    const result = await apiClient('/products');
    expect(Array.isArray(result)).toBe(true);
  });

  it('handles API errors by code, not message', async () => {
    try {
      await apiClient('/orders/invalid-id');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error.code).toBe('ORDER_NOT_FOUND'); // Branch on code
      expect(error.status).toBe(404);
    }
  });

  it('includes idempotency key on mutations', async () => {
    // Verify your apiClient adds idempotency-key header
    // for POST /orders, POST /payments/initiate, etc.
  });
});
```

### E2E Test Critical Paths

**Authentication Flow:**
1. Register → Receive OTP → Verify → Get tokens
2. Login → Get access token → Access protected route
3. Token expiry → Auto-refresh → Retry original request
4. Refresh failure → Redirect to login

**Checkout Flow (PREPAID):**
1. Add to cart → Cart persisted in DB
2. Enter address → Validate pincode
3. Place order → Get order ID
4. Initiate payment → Get razorpay_order_id
5. Complete Razorpay → Verify payment → Order confirmed
6. View order → Show correct status

**Checkout Flow (COD):**
1. Add to cart
2. Enter address
3. Place order with `paymentMode: 'COD'`
4. Order confirmed immediately (no Razorpay)

**Admin Flow:**
1. Login with admin credentials
2. View orders list
3. Update order status (ship/cancel)
4. Verify idempotency key sent
5. Verify permission error if unauthorized

### Test Data Management

**Never use production data in tests.** Use:
- `scripts/seed-flash-sale-fixtures.js` for stress test data
- `npm run db:seed` (if available) for consistent test fixtures
- Factory pattern for generating test orders, products, users

**Database Reset Between Test Suites:**
```bash
# In CI or local test run
docker exec ecom-postgres psql -U postgres -d ecom_template -c "
  TRUNCATE TABLE orders, order_items, cart_items, payments CASCADE;
"
# Or use Prisma: npx prisma migrate reset --force
```

### Debugging Backend Integration Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `fetch failed` in test | Backend not running | `npm run dev:e2e` in separate terminal |
| `P1000` error | DB password mismatch | `ALTER USER` command or wipe volume |
| `ECONNRESET` | Redis password blank | Set `REDIS_PASSWORD`, wipe container |
| `401 Unauthorized` | Token expired/missing | Check Zustand auth state, refresh flow |
| `403 Forbidden` | Permission insufficient | Check user role, verify backend permission guard |
| `Idempotency-Key` error | Duplicate key sent | Ensure unique UUID per request |
| Price mismatch | Frontend calculating total | Use backend-returned amount only |

### CI/CD Integration Test Gate

Before any PR can merge:
```bash
# 1. Backend must be running with clean DB
docker compose up -d postgres redis
npm run db:migrate
npm run dev:e2e &
npm run dev:e2e:workers &

# 2. Run frontend integration tests
npm run test:integration

# 3. Run E2E tests (if configured)
npm run test:e2e

# 4. Build check
npm run build
```

### Backend Reliability Gates Note
The backend runs `npm run ci:reliability-gates` in CI. The `contract:admin` gate may fail locally if no backend is running at `BASE_URL` (default `http://127.0.0.1:3000`). Core gates (typecheck, unit/e2e/security tests, build, Prisma validation) can pass without a running backend, but admin contract smoke requires seeded admin credentials. Always verify backend is healthy before running full reliability gates locally.

---

## 12. Forbidden Actions — NEVER Do These

### Code Quality
- ❌ NEVER use `any` type
- ❌ NEVER use `export default`
- ❌ NEVER use raw `<img>` tags — use `next/image`
- ❌ NEVER use `console.log` in committed code
- ❌ NEVER put `"use client"` on layout files
- ❌ NEVER use `useEffect` for data fetching — use Server Components
- ❌ NEVER create API routes for data that Server Components can fetch
- ❌ NEVER use inline styles or CSS modules — use Tailwind
- ❌ NEVER use arbitrary Tailwind values (`text-[#FF5733]`, `p-[13px]`) — define tokens
- ❌ NEVER use raw Tailwind color defaults — define semantic palette in config
- ❌ NEVER use multiple icon libraries — Lucide React only
- ❌ NEVER use placeholder image URLs (picsum, unsplash CDN, via.placeholder)
- ❌ NEVER skip `loading.tsx` on any route segment
- ❌ NEVER skip `alt` text on images
- ❌ NEVER skip `aria-label` on interactive elements
- ❌ NEVER use px for font sizes — use rem via Tailwind classes
- ❌ NEVER do price math on display values — always use paise integers
- ❌ NEVER ignore mobile viewport in any component
- ❌ NEVER delete `.agents/`, `.cursor/`, or IDE config directories
- ❌ NEVER blindly merge Dependabot major-version PRs — these require manual migration and guide the developer on how to do it.

### Security (CRITICAL)
- ❌ **NEVER store JWT tokens in `localStorage` or `sessionStorage`** — memory only
- ❌ **NEVER store refresh tokens in browser storage** — httpOnly cookies only
- ❌ **NEVER parse `error.message` for branching logic** — use `error.code` only
- ❌ **NEVER show full error details or stack traces to users** — generic messages only
- ❌ **NEVER use `eval()` or `new Function()`** with user input
- ❌ **NEVER use `innerHTML` or `dangerouslySetInnerHTML`** with user content
- ❌ **NEVER use inline `<script>` tags** — external JS files only
- ❌ **NEVER use inline `style=` attributes** — CSS classes only (CSP requirement)
- ❌ **NEVER trust client-side permission checks alone** — backend validates all
- ❌ **NEVER call webhook endpoints from browser code** — server-only
- ❌ **NEVER hardcode API URLs or secrets in client bundles** — use env vars
- ❌ **NEVER skip OTP challenge flow for critical ops operations** — 5 endpoints require it
- ❌ **NEVER show plaintext secret values in admin UI** — mask all secrets
- ❌ **NEVER use `x-ops-key-id` or `x-ops-api-key` headers** — browser-session-only for ops

---

## 13. Preferred Workflow for Changes

1. **Understand** — Read the relevant component files and design intent first.
2. **Component First** — Build leaf components (Card, Badge, Price) before assembling pages.
3. **Server First** — Default to Server Components, add `"use client"` only when proven necessary.
4. **Validate** — After every change:
   ```bash
   npm run typecheck    # Zero errors
   npm run lint         # Zero warnings
   npm run build        # Successful production build
   ```
5. **Visual Check** — Always verify the change renders correctly at mobile (375px), tablet (768px), and desktop (1280px) viewports.
6. **Accessibility Check** — Tab through the changed UI to verify keyboard navigation works.

---

## 14. Git & Workflow

### Branching
- `main` — trunk, always deployable
- `feature/<description>` — short-lived (max 2–3 days)
- `fix/<description>` — bug fixes
- `staging` — preview deployment
- `production` — live site

### Commit Convention
```
<type>(<scope>): <description>

Types: feat, fix, refactor, docs, test, chore, perf, style, a11y
Scope: component or page name (e.g., ProductCard, checkout, header)
```

### Before Every PR
```bash
npm run typecheck        # Zero errors
npm run lint             # Zero warnings
npm run build            # Successful build
npx lighthouse-ci       # Core Web Vitals pass (if configured)
```

### Co-Development with Backend Template (mandatory)

Canonical source: `CO_DEVELOPMENT_SYNC_GUIDE.md` (git mechanics of upstreaming) + `backend/docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md` (the versioning + changelog + design-isolation + drift-enforcement layer on top).

**Platform versioning model (applies to every core change):** shared code is versioned as `backend-core` / `frontend-core` (semver; `backend/package.json` + `frontend/package.json` `version` are the source of truth, surfaced at `/health`). Each core change gets a `CHANGELOG.md` entry with a **Propagation** block (severity · layers · migration · flag · design impact · breaking · rollback) — that entry is what tells every client repo how to apply it. Per-client differences must stay OUT of core code: **design** lives in the token layer (`frontend/app/globals.css`, `lib/fonts.ts`, `lib/constants.ts`, `public/` — protected by `.gitattributes merge=ours`); **feature differences** live in `FEATURE_*` flags (ship new features OFF by default); **true one-offs** live in `src/modules/client/**` / `app/(client)/**`. `core-manifest.json` + `backend/scripts/check-core-drift.sh` forbid silent core forks; `frontend/design-tokens.contract.json` + `backend/scripts/check-token-contract.sh` guarantee new components theme correctly per client. When you change core: update the relevant `CHANGELOG.md`, bump the package.json `version`, and keep `PLATFORM_VERSION` + the tag in sync.

**Canonical change flow (automated — guide §12):** develop in any client (commits/pushes stay on that client; feature behind a `FEATURE_*` flag OFF) → **cherry-pick** the commits into the template (`git fetch <client> && git cherry-pick <range>`; the template holds a git remote per client) → CHANGELOG + version bump + `git tag <core>-vX.Y.Z` + push. The tag fires `.github/workflows/release-train.yml` (template) which dispatches each client's `.github/workflows/core-sync.yml`, running `backend/scripts/sync-core.mjs` (`npm run sync:core`) to pull only core files (design/client/approved-divergence excluded) and open a review PR. You merge each PR → CD deploys. **The tag is the "ship to every client" trigger; nothing propagates before it.** Existing clients (raghava, sbgs — unrelated histories) receive changes via this automation, NOT `git merge`; only clients cloned from the template can `git merge` a tag. Required keys/secrets per repo + new-client onboarding are in guide §13/§13.1.

When frontend implementation reveals a backend bug/improvement:
- Classify change as **template-worthy** or **client-specific**.
- Use the canonical guide for Flow A/Flow B command order.
- Use HTTPS + account chooser workflow for pushes to template repo.

**Agent instruction rule:**
- Agents must explicitly ask the user before any `git push`/remote mutation.
- Agents should propose commands and let the user run/approve them.
- After upstream merge, agents should tell the user to pull template updates back into active client repos.

---

## 15. Dependency Management & Dependabot

### Pinned Versions
- This project pins **exact dependency versions** in `package.json`. `npm install` always produces a reproducible build.
- **NEVER** blindly upgrade core dependencies (Next.js, React, Tailwind, TypeScript) to a new major version.

### Dependabot PRs
- After pushing to GitHub, Dependabot will open PRs for newer dependency versions. **This is normal.**
- **Red CI failures on Dependabot PRs do not mean the project is broken.** They mean the proposed upgrade is incompatible with the current code and your CI correctly rejected it.
- **Safe to merge:** Minor/patch bumps where CI passes green.
- **Close or ignore:** Major version bumps (Next.js 15→16, React 19→20, Tailwind 4→5). Do these as deliberate migration efforts.
- Add `ignore` rules in `.github/dependabot.yml` for noisy major-version PRs.

---

> **Where does this frontend fit in the deployment sequence?** Frontend build is **Phase 4** of the client onboarding process. Phase 5 is the mandatory full local integration testing gate (both checklists run against localhost before VPS is touched). Frontend deployment is **Phase 10**. These rules must be synced before Phase 4 begins. The complete ordered runbook — from client intake through DNS cutover — is in **[`../backend/docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`](../backend/docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md)**. Before go-live, verify this rules file is in sync with the backend copy (`frontend-agent-rules.md`) and both the backend and frontend go-live checklists are fully ticked.
>
> **Full-Stack Development Summary:** This guide now covers:
> - **Phase 0** (Session Start): Backend verification protocol
> - **Section 2**: Environment setup with troubleshooting (P1000, ECONNRESET fixes)
> - **Section 4.5**: Complete Security Model & Auth Architecture (June 2026)
> - **Section 9**: Backend contract integration (idempotency, envelope handling, error codes)
> - **Section 9.5**: Backend Architecture Notes (circuit breaker scope, Prisma drift guard, async lifecycles)
> - **Section 11.5**: Testing pyramid with real backend integration tests
> - **Section 12-15**: Quality gates, forbidden actions, Git workflow, dependency management
>
> **Quick Reference Links:**
> - Backend setup issues: `docs/MASTER_DEPLOYMENT_PLAYBOOK.md` Appendix H
> - VPS deployment: `docs/CLIENT_VPS_SETUP_GUIDE.md` §5
> - Integration guide: `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`
> - Go-live checklists: `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` + `docs/BACKEND_GO_LIVE_CHECKLIST.md`
> - Route surface (what every route does, permissions, boundaries): `docs/ROUTE_SURFACE_COMPLETE_REFERENCE.md`
> - Security hardening history: `docs/HARDENING_HISTORY.md`

---

## 16. Production Readiness & Security Verification (June 2026)

### Backend Security Status: ✅ VERIFIED

**All gates passing:**
- `npm run typecheck` → exit 0
- `npm run test:unit` → 487/487 tests pass
- `npm run ci:reliability-gates` → exit 0
- Security tests → all pass
- E2E tests → all pass

### Security Score: 10/10 — Maximum Protection

| Category | Score | Frontend Implications |
|----------|-------|----------------------|
| **Token Storage** | 10/10 | Access tokens memory-only; refresh httpOnly cookie |
| **Session Management** | 10/10 | Short TTL, rotation, ops session 24h |
| **Authentication** | 10/10 | 2-step OTP for admin/ops; 5 critical ops need secondary OTP |
| **Authorization** | 10/10 | 2 ops permissions (no OPS_APPROVE), 25 admin permissions |
| **Data Protection** | 10/10 | bcrypt, SHA256, AES-256-GCM |
| **Network Security** | 10/10 | Strict CSP (no 'unsafe-inline'), Helmet headers |
| **Audit** | 10/10 | Tamper-evident chain hashing |
| **Rate Limiting** | 10/10 | Tiered limits enforced |

### Frontend Security Requirements Summary

**Authentication:**
- ✅ Store access tokens in Zustand/memory (never localStorage)
- ✅ Refresh tokens handled automatically via httpOnly cookies
- ✅ Implement 401 → refresh → retry flow
- ✅ Logout clears client state + calls logout endpoint

**Ops UI:**
- ✅ Public routes only: `/ops/login`, `/ops/setup` (no Session/Config/Audit nav before login)
- ✅ Console layout + nav + sign out only after successful ops login (`ops_session` cookie)
- ✅ Implement OTP modal for all 5 critical operations
- ✅ Show 5-minute countdown for OTP expiry
- ✅ Handle 503 `ops_audit_chain_lock_timeout` with 1-2s retry
- ✅ No API key management UI (browser-session-only)

**Security Headers (Backend-Enforced):**
- ✅ Strict CSP: `style-src 'self'` — no inline styles allowed
- ✅ All styles in external CSS files
- ✅ All scripts in external JS files
- ✅ No `eval()` or `innerHTML` with user content

**Error Handling:**
- ✅ Branch on `error.code`, never `error.message`
- ✅ Generic error messages to users (no stack traces)
- ✅ Proper handling of 401, 403, 429, 503 errors

### Recent Security Hardening (Verified)

| Change | Status | Frontend Impact |
|--------|--------|-----------------|
| OTP enforcement on 5 critical ops endpoints | ✅ Complete | Must implement OTP modal flow |
| Dual approval system removal | ✅ Complete | `OPS_APPROVE` does not exist |
| CSP hardening (no 'unsafe-inline') | ✅ Complete | No inline styles allowed |
| Browser-session-only ops auth | ✅ Complete | No API key UI elements |
| OTP test hash fixes (SHA256) | ✅ Complete | N/A (backend only) |

### Critical Ops Endpoints Requiring OTP

1. `POST /api/v1/ops/config/save`
2. `POST /api/v1/ops/load-shed`
3. `POST /api/v1/ops/system/restart`
4. `POST /api/v1/ops/users/:id/deactivate`
5. `POST /api/v1/ops/invites/:id/revoke`

### Documentation References

- **Complete security model:** `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §4.2.1
- **Ops security deep dive:** `docs/OPS_CONTROL_PLANE_GUIDE.md` §2, §10
- **All routes detailed:** `docs/ROUTE_SURFACE_COMPLETE_REFERENCE.md` §26
- **Endpoint reference:** `docs/API_ENDPOINT_INDEX.md`
- **Go-live verification:** `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`
- **Security audit trail:** `docs/HARDENING_HISTORY.md`

---

**Status: PRODUCTION-READY** 🚀  
**Last Updated:** June 2026  
**Security Verification:** Complete  
**Recommended For:** Immediate deployment with confidence
