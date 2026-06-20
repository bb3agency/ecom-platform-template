---
trigger: always_on
---

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
3. **Confirm backend is running AND properly configured** — verify ALL of the following before writing frontend code:
   - Backend server (`npm run dev:e2e`) and workers (`npm run dev:e2e:workers`) are running
   - **Health check passes:** `curl http://localhost:3000/api/v1/health` returns `{"success":true,"data":{"status":"ok","db":"connected","redis":"connected"}}`
   - **Database is migrated:** `npx prisma migrate status --schema prisma/schema.prisma` shows "Database schema is up to date"
   - **Feature flags are set** in backend `.env` (ask which are enabled: `FEATURE_COUPONS_ENABLED`, `FEATURE_REVIEWS_ENABLED`, `FEATURE_WISHLIST_ENABLED`, `FEATURE_GST_INVOICING_ENABLED`, `FEATURE_RESPONSE_ENVELOPE_ENABLED`). **Storefront reads flags at runtime** via `GET /store/config` (`useStoreConfig()`) — not build-time `NEXT_PUBLIC_FEATURE_*`.
   - **Backend `.env` has valid `DATABASE_URL`** — if you see P1000 errors, the DB password in `.env` doesn't match the container; fix per `docs/MASTER_DEPLOYMENT_PLAYBOOK.md` Appendix H.4
   - If backend is not fully ready, STOP and guide the user through backend setup first per `README.md` §Local Development Quickstart
4. **Do not ask questions already answered in the project docs/checklists** (e.g. API URL, feature flags, or agreed delivery sequence).

5. **Admin console patterns (2026-06-03):** Per-page `AdminDateRangePicker`; product editor → `isActive` / `metaDescription` / `isFeatured`; no mock labels in admin tables. See `docs/FRONTEND_DEV_LOG.md`.

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
  5. Whether Resend is configured in the backend `.env` (key is backend-only, frontend does not need it — confirm it is set)
  6. Whether MSG91 SMS is configured in the backend `.env` (same — backend-only, confirm it is set)
  7. Whether Meta WhatsApp is configured in the backend `.env` (`META_WHATSAPP_ACCESS_TOKEN` — backend-only, confirm it is set if `NOTIFY_WHATSAPP_ENABLED=true`)
  8. Which feature flags are active for this client: `FEATURE_COUPONS_ENABLED`, `FEATURE_REVIEWS_ENABLED`, `FEATURE_WISHLIST_ENABLED`, `FEATURE_GST_INVOICING_ENABLED`, `FEATURE_RESPONSE_ENVELOPE_ENABLED`
  9. **Backend secrets verification:** Confirm backend `.env` has:
     - `JWT_SECRET` (unique per client, not placeholder)
     - `JWT_REFRESH_SECRET` (distinct from `JWT_SECRET`, never equal)
     - `ADMIN_MFA_ENCRYPTION_KEY` (independent secret, never equal to `JWT_REFRESH_SECRET`)
     - `OPS_DB_ENCRYPTION_KEY` (32-char hex, for DB config encryption)
     - `OPS_MFA_ENFORCE=true` (production-like profiles)
  10. Whether a `docs/FRONTEND_DEV_LOG.md` already exists in the frontend repo — if not, create one from the template in `../backend/docs/FRONTEND_DEV_LOG_TEMPLATE.md` before writing any code.
  Then automatically generate the `.env.local` file with all collected values.
- **Path Prefix:** `NEXT_PUBLIC_API_BASE_URL` MUST include `/api/v1`.
- **Canonical Names:** Use only `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_STOREFRONT_URL` (do not invent alternate names like `NEXT_PUBLIC_API_URL`).

### Backend Contract — AI Agent Baseline Enforcement Rules

Canonical contract detail lives in:
- `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`
- `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`
- `docs/BACKEND_GO_LIVE_CHECKLIST.md`

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
├── auth.ts                    # Zustand — auth tokens + user session
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

### Content Security Policy (CSP) Headers
When configuring Nginx or middleware, enforce these CSP rules:
```
default-src 'self';
connect-src 'self' https://api.yourdomain.com https://*.razorpay.com;
script-src 'self' 'unsafe-inline' https://checkout.razorpay.com;
style-src 'self' 'unsafe-inline';
img-src 'self' https: data: blob:;
frame-src https://checkout.razorpay.com;
```
- Never use `unsafe-eval` (prevents XSS via eval())
- Never use wildcard `*` in production CSP

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
3. **MFA enforcement** — If `ADMIN_MFA_ENFORCE=true`, require MFA setup for all admin users
4. **Session timeout warning** — Alert user before token expiry, auto-redirect on 401
5. **Idempotency keys** — REQUIRED for all admin mutations (create product, update inventory, refund order)

Admin-only features to hide from storefront:
- Inventory management
- Order status changes (ship, cancel, refund)
- User management
- Settings/config changes
- Analytics/reports

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
- Cart data persists in Zustand + localStorage across sessions.
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
2. **Ops control plane surfaces** — session bootstrap (`GET /ops/session`), load-shed two-step (request `POST /ops/load-shed` → separate approve/reject `POST /ops/approvals/:id/confirm|reject`), approvals queue, audit timeline, config overview/stored/save screens with masked values only.
3. **Admin read surfaces** — dashboard KPIs/charts, orders list/detail, inventory list, product list + categories, customer index + CRM view. Build before mutations so you have real data to validate against.
4. **Admin mutation surfaces** — ship action, checkout flows, cancel/refund, COD collection, return requests, stock adjustment, settings, coupon lifecycle, **product deactivate** (`DELETE /admin/products/:id`) + **permanent delete** (`DELETE /admin/products/:id/permanent` via `AdminRowActionsMenu`), product variant delete, review hard-delete, customer ban/unban, admin notes. Admin write forms must use `useAdminFormValidation` + field highlighting for `VALIDATION_ERROR` (see `NEXTJS_FRONTEND_INTEGRATION_GUIDE.md` §2.1.1).
5. **Reliability surfaces** — reconciliation issues, outbox dead-letter list + replay-preview + replay, inbox failures + replay-preview + replay, analytics (revenue, funnel, category breakdown, inventory alerts, notification delivery), Bull Board queue visibility.
6. **Storefront customer journey surfaces** — catalogue (product list/detail/categories/search), cart (guest session + merge-on-login + coupon + pincode check), PREPAID checkout (full Razorpay sequence), COD checkout, order history/detail/tracking, customer auth (OTP + email + forgot-password + refresh loop + logout), user profile + addresses. Run Resend email dry-run during checkout slice. Feature-flagged surfaces (wishlist, reviews, coupons) only if `FEATURE_*_ENABLED` is active.

Non-negotiable boundaries:
- Merchant operations stay on `/api/v1/admin/*`. Platform controls stay on `/api/v1/ops/*`.
- Never proxy merchant actions through ops APIs to simplify UI.
- Never persist raw ops credentials in browser storage or URLs.
- Ops dual-approval UX is always two explicit steps: `request` then `confirm/reject`. Never auto-confirm in one click.
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
NEXT_PUBLIC_STORE_NAME="Raghava Organics"

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
- Frontend secret handling must follow `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md`.

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
| Migrations current | `npx prisma migrate status` | Run `npx prisma migrate dev` |
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
- ❌ NEVER use `localStorage` directly — wrap in Zustand persistence
- ❌ NEVER delete `.agents/`, `.cursor/`, or IDE config directories
- ❌ NEVER blindly merge Dependabot major-version PRs — these require manual migration and guide the developer on how to do it.

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

Canonical source: `CO_DEVELOPMENT_SYNC_GUIDE.md`.

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
> - **Section 4.5**: Security patterns (CSP, XSS prevention, checkout security)
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
