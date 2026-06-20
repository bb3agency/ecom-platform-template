# 🚀 E-Commerce Frontend — AI Prompting Playbook

> **Purpose:** This document is the definitive guide for using AI tools (Cursor, v0.dev, Claude, Gemini, Bolt, Lovable) to build a **SaaS-level, high-conversion e-commerce frontend** that connects to this Fastify backend template.
>
> **Sources:** Compiled from Vercel docs, Anthropic guides, Google AI docs, Cursor community, Reddit r/webdev & r/reactjs, Baymard Institute UX research, NNGroup, CXL conversion studies, and developer forums (2025–2026).
>
> **Lifecycle:** This playbook is **build-time only**. After development/go-live, use `docs/CLIENT_HANDOFF_INDEX.md` and linked Client-Main docs as primary references.

Phase-aware usage rule:
- During active frontend development: use this playbook as SOP.
- After development/go-live: do not use this as the primary client-facing reference set.

---

## Table of Contents

1. [The Golden Rules](#1-the-golden-rules)
2. [The Master System Prompt](#2-the-master-system-prompt)
3. [Cursor IDE Setup](#3-cursor-ide-setup)
4. [The Prompting Framework (PCTF)](#4-the-prompting-framework-pctf)
5. [Page-by-Page Prompt Templates](#5-page-by-page-prompt-templates)
6. [Design System Prompt](#6-design-system-prompt)
7. [High-Conversion UX Patterns](#7-high-conversion-ux-patterns)
8. [Color Psychology & Typography](#8-color-psychology--typography)
9. [Micro-Interactions & Animations](#9-micro-interactions--animations)
10. [Next.js Architecture Prompt](#10-nextjs-architecture-prompt)
11. [Anti-Patterns to Avoid](#11-anti-patterns-to-avoid)
12. [The Iterative Refinement Workflow](#12-the-iterative-refinement-workflow)
13. [Quality Assurance Prompts](#13-quality-assurance-prompts)
14. [v0.dev Specific Tips](#14-v0dev-specific-tips)

---

## 1. The Golden Rules

These are non-negotiable principles distilled from thousands of developer hours:

| # | Rule | Why |
|---|------|-----|
| 1 | **Never generate an entire page in one prompt** | AI produces "slop" — brittle, disorganized code. Build component by component. |
| 2 | **Always provide your design system/tokens first** | Without context, AI defaults to generic Bootstrap-like output. |
| 3 | **Specify what NOT to do** | Constraints prevent the AI from hallucinating libraries, placeholder images, or wrong patterns. |
| 4 | **Use visual references** | Upload screenshots, Figma exports, or competitor URLs. Multimodal input produces 3x better results. |
| 5 | **Treat AI output as a first draft** | Always review for accessibility, security (XSS), performance, and edge cases. |
| 6 | **Commit before every AI generation** | Git is your safety net. If the AI breaks something, `git checkout .` instantly. |
| 7 | **Build small, compose big** | Card → Grid → Section → Page. Never the reverse. |

---

## 2. The Master System Prompt

Copy this into your AI tool's system prompt (`.cursorrules`, `.agents/rules/dev-rules.md` for Antigravity, or chat preamble) before starting any frontend work.

> **Shortcut:** The file `frontend-agent-rules.md` in this repo is a ready-to-use Antigravity rules file. Copy it to `.agents/rules/dev-rules.md` in your frontend project and it auto-activates.

```markdown
You are a Senior Frontend Architect specializing in high-conversion e-commerce 
interfaces. You have 12+ years of experience building storefronts for D2C brands 
generating $1M+ ARR.

## Tech Stack (Non-Negotiable)
- Framework: Next.js 15+ (App Router, React Server Components)
- Language: TypeScript (strict mode, no `any`)
- Styling: Tailwind CSS 4+
- UI Library: shadcn/ui (Radix primitives)
- Icons: Lucide React (ONLY — no other icon libraries)
- Animations: Framer Motion
- State: Zustand (client-side cart/auth state only)
- Data Fetching: Server Components + Server Actions
- Validation: Zod
- Forms: React Hook Form + Zod resolvers

## Architecture Rules
1. Default to Server Components. Use `"use client"` ONLY for interactivity.
2. Co-locate data fetching inside the component that needs it.
3. Use `loading.tsx` and `<Suspense>` for streaming.
4. All images use `next/image` with `priority` on LCP elements.
5. All forms use Server Actions for mutations, not API routes.
6. Use `revalidatePath()` or `revalidateTag()` after every mutation.
7. Implement JSON-LD structured data on all product/category pages.

## Design Philosophy
- Premium, modern, editorial aesthetic — NOT generic template look
- Mobile-first responsive design (breakpoints: sm:640, md:768, lg:1024, xl:1280)
- 8px spacing grid system
- Maximum 3 font weights per page
- High contrast, WCAG AA compliant
- Generous whitespace — let the products breathe
- Subtle micro-animations on interactions (hover, focus, page transitions)

## Code Standards
- Named exports only (no default exports)
- Props interfaces named `[Component]Props`
- One component per file
- Error boundaries on every route segment
- Loading skeletons for all async data
- Descriptive `aria-labels` on all interactive elements
```

---

## 3. Initial Environment Setup

### 3.1 Backend `.env` must be configured first

**Before prompting the AI to build anything**, verify the backend `.env` has these set correctly.

**Pre-check rules (verify before touching Docker):**
- `POSTGRES_DB` must use **underscores only** — PostgreSQL forbids hyphens in DB names (`raghava_organics` ✓, `raghava-organics` ✗)
- `POSTGRES_DB` and the DB name in `DATABASE_URL` **must be identical**
- `REDIS_PASSWORD` must be **non-empty** — blank causes `ECONNABORTED` loops in ioredis on every reconnect
- `REDIS_URL` must embed the password: `redis://:password@localhost:6379`
- Changing `POSTGRES_DB`, `POSTGRES_PASSWORD`, or `REDIS_PASSWORD` after first container start requires `docker compose down -v`

```env
# ── Identity ───────────────────────────────────────────────────────────────
# Docker container names are derived from CLIENT_ID: <CLIENT_ID>-postgres, <CLIENT_ID>-redis
CLIENT_ID=raghava-organics            # <-- SET THIS (slug, no spaces, unique per project)

# ── Database ───────────────────────────────────────────────────────────────
# DB name: underscores only — hyphens are invalid in PostgreSQL
POSTGRES_DB=raghava_organics           # <-- SET THIS (underscores only, must match DATABASE_URL)
POSTGRES_PASSWORD=yourpassword         # <-- SET THIS
# DB name in URL must exactly match POSTGRES_DB above
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/raghava_organics  # <-- SET THIS

# ── Redis ───────────────────────────────────────────────────────────────────
# NEVER blank — blank REDIS_PASSWORD causes ECONNABORTED/ECONNRESET on every ioredis reconnect
REDIS_PASSWORD=yourredispassword       # <-- SET THIS (non-empty)
REDIS_URL=redis://:yourredispassword@localhost:6379  # <-- SET THIS (must embed REDIS_PASSWORD)

# ── Bootstrap secrets ───────────────────────────────────────────────────────
JWT_SECRET=<64-char-hex>               # <-- SET THIS
JWT_REFRESH_SECRET=<different-64-char-hex>  # <-- SET THIS
OPS_DB_ENCRYPTION_KEY=<32-char-hex>    # <-- SET THIS
```

> Generate secrets: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Then start the backend and verify it is healthy before writing any frontend code. For authoritative backend configuration (what is bootstrap env vs Ops DB overlay, mutability, restart requirements), use `docs/ENV_VS_DB_CONFIG_REFERENCE.md`. For the step-by-step first-deploy Phase 1/2 model (including `RESEND_API_KEY` bootstrap requirement for ops-newuser), see `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md`.

```bash
# Terminal 1
cmd /c npm run dev:e2e

# Terminal 2
cmd /c npm run dev:e2e:workers

# Health gate — do NOT proceed until this returns db+redis connected
curl http://localhost:3000/api/v1/health
# Expected: {"success":true,"data":{"status":"ok","db":"connected","redis":"connected"}}
```

If `db` or `redis` shows `disconnected`, fix the backend first. See `README.md` §Local Development Quickstart for full triage steps.

### 3.2 Frontend `.env.local`

*Rule for AI:* Before starting any development, ask the user for their Backend API URL and Store Name. Then generate the `.env.local` file automatically:

```env
# .env.local  (development)
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1   # must include /api/v1
NEXT_PUBLIC_STORE_NAME="Your Brand Name"
NEXT_PUBLIC_STOREFRONT_URL=http://localhost:3001
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxx              # public key ONLY — never the secret

# Required on VPS by vps-frontend-deploy.sh for PM2 process naming and health checks.
# Set these in .env.local (or .env.production.local) on the VPS before the first deploy.
CLIENT_ID=your-client-id                                # e.g. greengrocer (slug, no spaces)
STOREFRONT_PORT=3101                                    # matches Nginx proxy_pass + port assignment
```

Never hardcode API URLs in fetch calls. Always use `process.env.NEXT_PUBLIC_API_BASE_URL`. Ensure all client components that need it use the `NEXT_PUBLIC_` prefix.

Never include secret/backend-only keys in frontend env files. `CLIENT_ID` and `STOREFRONT_PORT` are infrastructure variables, not secrets — they are safe in `.env.local`. For provider onboarding and key lifecycle policy, follow `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md`.

### 3.3 Repo-specific frontend integration contract (must follow)

This section is intentionally concise. Canonical contract detail lives in:
- `docs/NEXTJS_FRONTEND_INTEGRATION_GUIDE.md`
- `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md`
- `docs/BACKEND_GO_LIVE_CHECKLIST.md`
- `docs/ROUTE_SURFACE_COMPLETE_REFERENCE.md` — deep per-route reference: every route's purpose, required permission, data it touches, constraints, setup flows, and hard layer boundaries (what admin cannot do, what ops cannot do, what no route exists for). Use when building or prompting for any admin/ops/customer surface.

Minimum non-negotiable implementation rules:
1. Use `NEXT_PUBLIC_API_BASE_URL` (with `/api/v1`) and no hardcoded API URLs.
2. Support both success response shapes (enveloped and raw).
3. Handle auth refresh-on-401 and keep refresh token out of browser storage.
4. Send `idempotency-key` for critical checkout/admin mutations and handle `409` safely.
5. Implement exact PREPAID vs COD split; treat shipping as manual-only admin action.
6. Browser must never call webhook routes.
7. Respect admin permission token-snapshot behavior and deferred refund semantics.
8. Keep ops config/admin invite boundaries aligned with backend contracts.
9. Build via vertical slices (not page-first), with real backend integration per slice.
10. Complete paired go-live checklists before release.
11. **Technical failure alerting:** The backend emits structured email alerts (`sendTechnicalFailureAlert`) to all active Ops + Admin users on every critical error path. Frontend error handling should surface user-facing messages via `error.code` while backend alerting covers operational visibility. Verify alert delivery is configured per `docs/BACKEND_GO_LIVE_CHECKLIST.md` §2.8.

> **Full-Stack Tip:** If your local backend is crashing with an infinite `ECONNRESET` loop on startup, it means your Docker Redis is in protected mode. You must add `REDIS_PASSWORD=localpassword` to the *backend's* `.env` file and recreate the container with `docker compose down -v`.

### 3.4 Ops Authentication & Control Plane

**Ops is the administrative control plane** - separate from customer and admin authentication:

**Ops frontend route shell:** Only `/ops/login` and `/ops/setup` are public (no console nav). All other `/ops/*` pages require `GET /ops/session` success; redirect to `/ops/login` on `401`.

**Ops Login Flow (Browser Session Cookie):**
```typescript
// Step 1: Request OTP
await api.post('/ops/auth/login/request-otp', { email, password });

// Step 2: Verify OTP — cookie set automatically
const { opsUserId, permissions } = await api.post('/ops/auth/login/verify-otp', { email, otp });
// No token to store — cookie handles everything

// Step 3: All ops requests use credentials: 'include'
await api.get('/ops/config/overview', { credentials: 'include' });
```

**Critical Operations Requiring OTP Challenge:**
The following 5 operations require a 2-step OTP flow:

1. `POST /ops/config/save` - Save system configuration
2. `POST /ops/load-shed` - Change load-shed mode (`normal | reduced | emergency | maintenance`). `maintenance` is durable (Postgres-backed) with a 2-min `pending` warning before Nginx serves the static maintenance page; exits only via another mode change here.
3. `POST /ops/system/restart` - Restart application services
4. `POST /ops/users/:id/deactivate` - Deactivate admin users
5. `POST /ops/invites/:id/revoke` - Revoke admin invitations

**Public maintenance status (storefront banner):**
- `GET /api/v1/maintenance/status` — public, unauthenticated, rate-limit-exempt. Returns `{ mode, phase, pendingUntil, activatedAt, serverTime }`. Poll every 60 s in steady state, every 5 s during `maintenance/pending` to keep the countdown accurate. Always use `serverTime` to anchor the countdown — never the device clock.
- `GET /api/v1/maintenance/gate` — internal Nginx subrequest only; clients should never call this directly.
- Mount a global `MaintenanceBanner` in the root layout; hide it on `/ops/*` routes; render nothing in `normal | reduced | emergency` modes.

**OTP Challenge Pattern:**
```typescript
// Component: CriticalOpsAction.tsx
function CriticalOpsAction({ action, onExecute, buttonText }) {
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);

  const handleInitiate = async () => {
    // Step 1: Request OTP challenge (body field is `action`, not actionType)
    const { challengeId, expiresAt } = await api.post('/ops/otp/request', { action });
    setChallengeId(challengeId);
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
          onSubmit={handleVerifyAndExecute}
          onCancel={() => setShowOtpModal(false)}
        />
      )}
    </>
  );
}
```

**Provider Configuration via Ops UI:**
All provider keys (Razorpay, MSG91/Fast2SMS, Resend, Meta WhatsApp, Delhivery, Shiprocket) are configured through the Ops UI, not environment variables:

```typescript
// Save provider config
await api.post('/ops/config/save', {
  RAZORPAY_KEY_ID: 'rzp_live_xxx',
  MSG91_AUTH_KEY: 'encrypted_value',
  RESEND_API_KEY: 'encrypted_value',
  META_WHATSAPP_ACCESS_TOKEN: 'encrypted_value'
}, { 
  headers: { 'X-Otp-Code': otpCode }, // Required for config changes
  credentials: 'include' 
});
```

### 3.5 Provider Configuration Details

**SMS Provider Selection (Backend `.env`):**
```bash
# Choose ONE of these in backend .env
SMS_PROVIDER=msg91      # MSG91 (template-based SMS)
SMS_PROVIDER=fast2sms   # Fast2SMS (direct API SMS)  
SMS_PROVIDER=noop       # Development mode (no actual SMS)
```

**SMS Provider Implementation:**
```typescript
// Detect active SMS provider
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

**Meta WhatsApp Configuration (Backend `.env`):**
```bash
# Enable/disable WhatsApp (independent of SMS provider)
NOTIFY_WHATSAPP_ENABLED=true     # Enable Meta Cloud API
NOTIFY_WHATSAPP_ENABLED=false    # Disable WhatsApp
```

**WhatsApp Features:**
- 2-way customer communication (order updates, support)
- Template-based messages for notifications
- Interactive buttons for quick actions
- Separate from SMS provider (can work with any SMS provider)

**WhatsApp Implementation:**
```typescript
// Check WhatsApp availability
const isWhatsAppEnabled = async (): Promise<boolean> => {
  const { data: { config } } = await api.get('/ops/config/whatsapp');
  return config.NOTIFY_WHATSAPP_ENABLED;
};

// Send WhatsApp message
if (await isWhatsAppEnabled()) {
  await whatsappClient.sendTemplateMessage(
    customer.phone,
    'order_confirmation',
    { order_id: order.id, total: formatPrice(order.total) }
  );
}
```

**Provider Keys Management:**
All provider API keys are configured through the Ops UI, not environment variables:

**Bootstrap Keys (Backend `.env` only):**
- `JWT_SECRET` - Unique per client
- `JWT_REFRESH_SECRET` - Different from JWT_SECRET
- `OPS_DB_ENCRYPTION_KEY` - 32-char hex for encrypting Ops DB secrets

**DB-Backed Keys (Ops UI → `/ops/config/save`):**
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- `MSG91_AUTH_KEY` or `FAST2SMS_API_KEY`
- `RESEND_API_KEY`
- `META_WHATSAPP_ACCESS_TOKEN`, `META_WHATSAPP_PHONE_NUMBER_ID`
- `DELHIVERY_API_KEY`, `DELHIVERY_API_SECRET`
- `SHIPROCKET_API_KEY`, `SHIPROCKET_API_SECRET`

**Important:** Provider keys stored in Ops DB are encrypted and require OTP to modify. Changes take effect after API restart.

### 3.6 Production First Deploy Checklist

**Critical:** For first-time production deployments, follow the Phase 1/2 bootstrap model:

**Phase 1: Bootstrap (Ops DB not reachable)**
1. Set bootstrap secrets in backend `.env`:
   - `JWT_SECRET` (64-char hex)
   - `JWT_REFRESH_SECRET` (different 64-char hex)
   - `OPS_DB_ENCRYPTION_KEY` (32-char hex)
   - `RESEND_API_KEY` (required for ops-newuser.mjs)

2. Run ops-newuser to create first Ops user:
   ```bash
   cd backend
   node scripts/ops-newuser.mjs your-email@company.com
   ```

3. Access Ops UI and configure remaining provider keys via `/ops/config/save`

**Phase 2: Full Configuration (Ops DB reachable)**
1. Configure all provider keys through Ops UI (not .env):
   - Razorpay (test/live keys)
   - SMS provider (MSG91/Fast2SMS)
   - Meta WhatsApp (if enabled)
   - Email (Resend)
   - Shipping (Delhivery/Shiprocket)

2. Verify all integrations in Ops UI
3. Restart backend services to apply DB-backed config

**Frontend Production Variables:**
```env
# Source template in repo: frontend/.env.production.example
# VPS bootstrap: cp .env.production.example .env.production.local
# .env.production.local (VPS deployment)
NEXT_PUBLIC_API_BASE_URL=https://your-domain.com/api/v1
NEXT_PUBLIC_STORE_NAME="Your Brand Name"
NEXT_PUBLIC_STOREFRONT_URL=https://your-domain.com
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_xxx    # Production key
INTERNAL_API_BASE_URL=http://127.0.0.1:3001/api/v1
CLIENT_ID=your-client-id                     # PM2 process naming
STOREFRONT_PORT=3101                         # Nginx proxy port
OPS_UI_BASIC_AUTH_USERNAME=<set-on-shared-vps>
OPS_UI_BASIC_AUTH_PASSWORD=<set-on-shared-vps>
```

**Shared VPS hard constraints (must enforce):**
- Nginx onboarding is additive (`sites-available/<domain>` + symlink); do not remove `sites-enabled/default` blindly.
- Install `snippets/rate-zones.conf` once per VPS and include from `nginx.conf` `http {}`.
- Redis stays internal to Docker network in production; comment out `redis.ports` to avoid host `:6379` conflicts/exposure.
- During Phase 7 bootstrap, inspect readiness with `curl -sS /api/v1/health/ready` (not `-f`) because expected `503` may carry required `runtimeConfigMissingKeys` diagnostics until Phase 8.

**Production Deployment Order:**
1. Backend healthy with all providers configured
2. Frontend built and deployed
3. Nginx configured with TLS
4. DNS pointed to VPS
5. SSL certificates installed

**Reference Documents:**
- `docs/PRODUCTION_FIRST_DEPLOY_CHECKLIST.md` - Complete step-by-step guide
- `docs/ENV_VS_DB_CONFIG_REFERENCE.md` - Bootstrap vs DB config mapping
- `docs/CLIENT_VPS_SETUP_GUIDE.md` - VPS hardening and setup

---

## 4. IDE Agent Setup (Cursor + Antigravity)

### Antigravity (Google) Setup

```bash
# Assuming sibling folders: root/backend and root/frontend
# Run this inside your frontend project folder:
mkdir -p .agents/rules
cp ../backend/frontend-agent-rules.md .agents/rules/dev-rules.md
diff -u ../backend/frontend-agent-rules.md .agents/rules/dev-rules.md
```

The rules file auto-activates on every interaction ("Always On" mode). It covers tech stack, architecture, code standards, performance, conversion optimization, and 20+ forbidden actions.

If `diff` output shows differences, re-copy and commit `.agents/rules/dev-rules.md` before generating new frontend code.

### Co-Development Backend Upstream (manual command protocol)

Canonical source: `CO_DEVELOPMENT_SYNC_GUIDE.md` (git mechanics) + `docs/PLATFORM_VERSIONING_AND_SYNC_GUIDE.md` (versioned core + changelog propagation + design isolation across client sites).

**Flow A: Subtree (Frontend + Backend in one repo)**
```bash
# Add backend as subtree (one-time setup)
git subtree add --prefix backend https://github.com/your-org/ecom-backend-template main --squash

# Pull latest backend changes
git subtree pull --prefix backend https://github.com/your-org/ecom-backend-template main --squash

# Push client-specific changes upstream (careful!)
git subtree push --prefix backend https://github.com/your-org/client-repo main
```

**Flow B: Separate Repos (Recommended)**
```bash
# Clone backend template
git clone https://github.com/your-org/ecom-backend-template.git ../backend

# Sync backend changes (run from frontend repo)
rsync -av --exclude='.git' --exclude='node_modules' \
  ../backend/docs/ ../docs/
rsync -av ../backend/frontend-agent-rules.md .agents/rules/dev-rules.md

# Safety checklist before any backend changes
echo "=== Backend Sync Safety Checklist ==="
echo "1. Are you changing template-worthy code?"
echo "2. Have you committed all frontend changes?"
echo "3. Are you avoiding client-specific secrets?"
echo "4. Is this in a separate branch from main?"
read -p "Continue? (y/N): " confirm
```

**Template-Worthy vs Client-Specific:**
- **Template-worthy:** Core features, bug fixes, architectural improvements
- **Client-specific:** API keys, domain names, custom branding, feature flags

**Copy/Paste Safety Checklist:**
1. Never copy `.env` files or secrets
2. Always check for hardcoded client values before committing
3. Use `CLIENT_ID` placeholder, not actual client slug
4. Verify no customer PII in commits
5. Test with clean checkout before pushing

**Agent Rule:** Always propose commands and wait for user approval/execution for remote mutations.

### Cursor IDE Setup

#### `.cursor/rules/` Directory Structure

```
.cursor/
└── rules/
    ├── project-context.mdc      # Always active — stack & architecture
    ├── components.mdc           # Component naming & structure
    ├── api-integration.mdc      # Backend API connection patterns
    ├── seo-ecommerce.mdc        # SEO & structured data rules
    └── design-system.mdc        # Colors, typography, spacing tokens
```

### Key IDE Workflows

| Action | Cursor | Antigravity |
|--------|--------|-------------|
| **Reference files** | `@app/layout.tsx` | `@app/layout.tsx` |
| **Pull docs** | `@Next.js` or `@Tailwind CSS` | Built-in web search |
| **Multi-file refactors** | Agent mode | Agent mode (default) |
| **Generate components** | Composer (⌘K) | Chat panel |
| **Auto-fix lints** | Enable in settings | Auto-detected |

### Context Injection Checklist

Before any major prompt, ensure the AI has access to:
- [ ] `tailwind.config.ts` (your design tokens)
- [ ] `app/layout.tsx` (global layout structure)
- [ ] Your `types/` directory (TypeScript interfaces)
- [ ] At least one existing component (to learn your style)
- [ ] The backend API endpoint schema (from this repo's TRD.md)
- [ ] `.agents/rules/dev-rules.md` (Antigravity) or `.cursor/rules/*.mdc` (Cursor)
- [ ] `docs/ROUTE_SURFACE_COMPLETE_REFERENCE.md` — when building admin, ops, or any API-integrated surface: what every route does, required permissions, hard boundaries, setup flows, and what each layer cannot do

---

## 4. The Prompting Framework (PCTF)

Every prompt should follow this structure:

### **P** — Persona
> "You are a senior e-commerce frontend developer..."

### **C** — Context
> "I'm building a D2C fashion store using Next.js 15, Tailwind, and shadcn/ui. The backend API is a Fastify REST API (see attached types). The current page structure is..."

### **T** — Task
> "Create a ProductCard component that displays: image, title, price (with strike-through for discounts), rating stars, and an 'Add to Cart' button."

### **F** — Format & Constraints
> "Use TypeScript interfaces for all props. Use `next/image`. Include hover scale animation with Framer Motion. Ensure WCAG AA contrast. Do NOT use any external image URLs."

### Example Combined Prompt:

```
You are a senior e-commerce frontend developer specializing in 
high-conversion storefronts.

CONTEXT: I'm building a premium D2C fashion store. Stack: Next.js 15 
(App Router), TypeScript, Tailwind CSS, shadcn/ui, Framer Motion.

TASK: Create a `ProductCard` component for the product listing grid.

REQUIREMENTS:
- Layout: Vertical card with image (aspect-ratio 3:4), then content below
- Image: Use next/image, show a subtle zoom on hover (scale 1.05, 300ms ease)
- Badge: Show "SALE" badge if discountPercentage > 0 (top-left, red accent)
- Content: Product name (1 line, truncate), category (small, muted), price
- Price: Show original price with strikethrough if discounted, sale price in bold
- Rating: Star icons (filled/unfilled) with review count
- CTA: "Add to Cart" button — full width, primary color, with cart icon
- Hover: Entire card gets subtle shadow elevation on hover

CONSTRAINTS:
- Use named export
- Props interface named `ProductCardProps`
- Icons from lucide-react ONLY
- All text must meet WCAG AA contrast ratio
- Include proper aria-labels on the button
- Do NOT use placeholder image URLs — accept `imageSrc` as a prop

TYPESCRIPT INTERFACE:
interface Product {
  id: string;
  name: string;
  slug: string;
  category: string;
  price: number;          // in paise (divide by 100 for display)
  discountPercentage: number;
  rating: number;
  reviewCount: number;
  images: { url: string; alt: string }[];
  inStock: boolean;
}
```

---

## 5. Page-by-Page Prompt Templates

### 5.1 Homepage / Landing Page

```
Create the homepage for a premium e-commerce store.

SECTIONS (in order):
1. HERO: Full-width hero with background image, headline, subtext, 
   and primary CTA button. Use Framer Motion for staggered text entrance.
2. CATEGORIES: Horizontal scrollable category cards (image + name overlay)
3. FEATURED PRODUCTS: 4-column grid of ProductCard components
4. SOCIAL PROOF: Customer testimonials carousel (3 testimonials, auto-rotate)
5. NEWSLETTER: Email capture section with gradient background
6. TRUST BAR: Row of trust badges (Free Shipping, Secure Payment, Easy Returns)

DESIGN NOTES:
- Hero image should be full viewport height on desktop, 60vh on mobile
- Use skeleton loaders for product grid (server component with Suspense)
- Newsletter section should use a Server Action for form submission
- Each section should have generous vertical padding (py-16 md:py-24)
```

### 5.2 Product Listing Page (PLP)

```
Create a Product Listing Page with filtering and sorting.

LAYOUT:
- Desktop: Sidebar filters (left, 280px) + Product grid (right, 3-4 columns)
- Mobile: Filters in a slide-out Sheet (shadcn), grid becomes 2 columns

FILTERS (Sidebar):
- Category (checkbox list with counts)
- Price range (dual-handle slider)
- Rating (star filter, clickable)
- Availability (in stock toggle)
- "Clear All" button at top

SORTING: Dropdown in header — Newest, Price Low-High, Price High-Low, Popular

FEATURES:
- URL-based filtering (searchParams, not client state)
- Skeleton grid while loading (8 placeholder cards)
- "No results" empty state with illustration
- Pagination or infinite scroll with "Load More" button
- Product count display: "Showing 24 of 156 products"

PERFORMANCE:
- Use Server Components for the product grid
- Filters update URL searchParams (useRouter + shallow navigation)
- Images lazy-loaded except first row (priority on first 4)
```

### 5.3 Product Detail Page (PDP)

```
Create a Product Detail Page optimized for conversion.

ABOVE THE FOLD (Critical — must load instantly):
- Breadcrumbs (Home > Category > Product)
- Image gallery: Main image (left/top) + thumbnail strip
  - Desktop: Side-by-side layout (image 55%, details 45%)
  - Mobile: Full-width image carousel with dots indicator
  - Click to zoom (lightbox modal)
- Product title (h1)
- Rating stars + review count (clickable, scrolls to reviews)
- Price (large, bold) with discount badge if applicable
- Variant selectors (size, color) as visual swatches
- Quantity selector
- "Add to Cart" button (large, primary, sticky on mobile)
- "Buy Now" button (secondary)
- Trust indicators inline (Free shipping, Easy returns, Secure checkout)

BELOW THE FOLD:
- Tabbed content: Description | Specifications | Reviews
- "You May Also Like" — related products carousel
- Recently viewed products

CONVERSION BOOSTERS:
- Stock urgency: "Only 3 left in stock" (if qty < 5)
- Social proof: "142 people bought this in the last 7 days"
- Sticky mobile bottom bar with price + Add to Cart (appears on scroll)

SEO:
- JSON-LD Product structured data
- Dynamic metadata (title, description, og:image)
- Canonical URL
```

### 5.4 Cart Page

```
Create a shopping cart page.

LAYOUT:
- Desktop: Cart items (left, 65%) + Order summary (right, 35%, sticky)
- Mobile: Stacked — items first, summary below

CART ITEM ROW:
- Product thumbnail (80x80)
- Product name + selected variant (size, color)
- Unit price
- Quantity selector (- / count / +) with Server Action update
- Line total
- Remove button (trash icon, with confirmation)

ORDER SUMMARY:
- Subtotal
- Shipping estimate (or "Free" with green badge)
- Coupon code input with "Apply" button
- Discount line (if coupon applied, show savings in green)
- Estimated tax
- Order total (large, bold)
- "Proceed to Checkout" button (full width, primary)
- Accepted payment method icons below button

EMPTY STATE:
- Illustrated empty cart graphic
- "Your cart is empty" message
- "Continue Shopping" CTA button

OPTIMIZATION:
- Use optimistic updates for quantity changes (useOptimistic)
- Persist cart in Zustand with localStorage sync
- Show skeleton while cart loads
```

### 5.5 Checkout Page

```
Create a streamlined checkout page optimized for minimal abandonment.

LAYOUT:
- Desktop: Form (left, 60%) + Live order summary (right, 40%, sticky)
- Mobile: Collapsible order summary at top, form below

STEPS (Single page, accordion-style):
1. Contact Information (email, phone)
2. Shipping Address (with Google Places autocomplete)
3. Shipping Method (radio cards with estimated delivery dates)
4. Payment (radio cards: "Pay Online" via Razorpay OR "Cash on Delivery" if store has COD enabled)

FEATURES:
- Guest checkout by default (no forced account creation)
- Auto-fill support for returning customers
- Real-time form validation with Zod + React Hook Form
- Progress indicator showing current step
- Display total cost including tax and shipping BEFORE payment step
- Trust badges near payment section (SSL, secure payment logos)

ANTI-ABANDONMENT:
- Exit-intent detection (optional): Show "Are you sure?" modal
- Save cart state — if user returns, cart is preserved
- Clear error messages — never just "Invalid input"
```

---

## 6. Design System Prompt

Use this prompt to generate your design tokens FIRST, before building any components:

```
Create a complete design system configuration for a premium e-commerce 
store. Output as a tailwind.config.ts file.

BRAND PERSONALITY: [Choose one]
- Option A: Luxury minimalist (think Aesop, COS)
- Option B: Bold & vibrant (think Glossier, Allbirds)  
- Option C: Dark & premium (think Apple Store, SSENSE)
- Option D: Warm & artisanal (think Etsy, Anthropologie)

REQUIREMENTS:
1. COLOR PALETTE:
   - Primary: Brand color + 50-950 scale
   - Secondary: Complementary accent
   - Neutral: Gray scale for text/backgrounds
   - Semantic: Success (green), Warning (amber), Error (red), Info (blue)
   - Surface: Card backgrounds, subtle borders

2. TYPOGRAPHY:
   - Heading font: [Modern display sans-serif, e.g., "Outfit" or "DM Sans"]
   - Body font: [Highly readable, e.g., "Inter" or "Plus Jakarta Sans"]
   - Mono font: For prices and codes
   - Scale: text-xs through text-5xl with proper line-heights

3. SPACING:
   - Based on 4px grid: 0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24
   
4. BORDER RADIUS:
   - Consistent system: sm (4px), md (8px), lg (12px), xl (16px), full

5. SHADOWS:
   - Subtle elevation system for cards, dropdowns, modals

6. ANIMATIONS:
   - Transition presets: fast (150ms), normal (300ms), slow (500ms)
   - Easing: ease-out for entrances, ease-in for exits

Output the complete tailwind.config.ts with all these tokens defined.
Also output a globals.css with CSS custom properties for theming.
```

---

## 7. High-Conversion UX Patterns

### Above-the-Fold Checklist (Product Pages)

Every product page MUST show these within the first viewport:

- [ ] Product image (high quality, zoomable)
- [ ] Product name (h1)
- [ ] Price (with discount indicator if applicable)
- [ ] Rating/reviews count
- [ ] Primary CTA ("Add to Cart")
- [ ] Key trust signal (free shipping/returns)

### Conversion Boosters to Include in Prompts

| Pattern | Prompt Snippet | Impact |
|---------|---------------|--------|
| **Urgency** | "Show 'Only X left' when stock < 5" | +15-27% conversion |
| **Social Proof** | "Display review count and rating near price" | +12-22% conversion |
| **Trust Badges** | "Show secure checkout, free returns badges near CTA" | +10-15% conversion |
| **Guest Checkout** | "Never force account creation before purchase" | -35% cart abandonment |
| **Transparent Pricing** | "Show total including tax/shipping before payment" | -25% checkout abandonment |
| **Sticky Mobile CTA** | "Sticky bottom bar with price + Add to Cart on scroll" | +8-12% mobile conversion |
| **Progress Indicator** | "Show checkout step progress bar" | -10% abandonment |
| **Skeleton Screens** | "Show content skeletons instead of spinners" | +20% perceived speed |

### Checkout Friction Reducers

Always include these in checkout prompts:
```
- Auto-detect card type from number
- Address autocomplete (Google Places API)
- Input masking for phone and card numbers
- Inline validation (not on-submit)
- "Same as shipping" toggle for billing address
- Order summary visible at all times on desktop
- Trust badges flanking the payment button
```

---

## 8. Color Psychology & Typography

### Color Guidelines for E-Commerce

| Color | Psychology | Best Used For |
|-------|-----------|---------------|
| **Orange** | Urgency, enthusiasm, action | "Buy Now" / "Add to Cart" CTAs, sale badges |
| **Green** | Trust, safety, positive outcome | "Checkout" button, "In Stock" indicators, success states |
| **Blue** | Trust, reliability, calm | Headers, navigation, links, trust badges |
| **Red** | Urgency, excitement, danger | Sale prices, limited stock warnings, error states |
| **Black** | Premium, luxury, sophistication | Luxury brand primary, dark mode backgrounds |
| **White** | Clean, minimal, spacious | Backgrounds, generous whitespace |

> **Critical Rule:** The CTA button color matters less than its **contrast** against the page. A green button on a green page is invisible. Always ensure your primary CTA is the most visually distinct element in its section.

### Typography Prompt

```
TYPOGRAPHY RULES:
- Headings: "Plus Jakarta Sans" (weight 600-700), tracking tight
- Body: "Inter" (weight 400-500), tracking normal  
- Price: "DM Mono" or tabular-nums for aligned price columns
- Minimum body text: 16px (1rem)
- Line height: 1.5 for body, 1.2 for headings
- Maximum 65 characters per line for readability
- Use font-weight and size for hierarchy — never color alone
```

---

## 9. Micro-Interactions & Animations

### Prompt Template for Animations

```
Add the following micro-interactions using Framer Motion:

1. PAGE TRANSITIONS:
   - Fade-in + slight upward slide (y: 20 → 0, opacity: 0 → 1)
   - Duration: 400ms, ease: [0.25, 0.1, 0.25, 1]

2. PRODUCT CARD HOVER:
   - Image: scale(1.05) over 300ms
   - Shadow: elevate from shadow-sm to shadow-lg
   - CTA button: slide up from hidden (translateY: 100% → 0)

3. ADD TO CART:
   - Button: Brief scale pulse (1 → 0.95 → 1) on click
   - Cart icon in header: Badge count increments with spring animation
   - Toast notification slides in from top-right

4. SCROLL ANIMATIONS:
   - Sections fade in when entering viewport (IntersectionObserver)
   - Stagger children by 100ms each
   - Only animate once (no re-trigger on scroll back up)

5. SKELETON LOADING:
   - Pulse animation on placeholder blocks
   - Gradient shimmer sweep (left to right)

CONSTRAINTS:
- Respect prefers-reduced-motion media query
- No animation longer than 500ms
- Use will-change sparingly (only on actively animating elements)
- GPU-accelerated transforms only (transform, opacity)
```

---

## 10. Next.js Architecture Prompt

Use this when setting up the project structure:

```
Set up a Next.js 15 e-commerce project with this folder structure:

app/
├── (storefront)/              # Public storefront layout group
│   ├── layout.tsx             # Header + Footer wrapper
│   ├── page.tsx               # Homepage
│   ├── products/
│   │   ├── page.tsx           # Product listing (PLP)
│   │   └── [slug]/
│   │       └── page.tsx       # Product detail (PDP)
│   ├── cart/
│   │   └── page.tsx           # Shopping cart
│   ├── checkout/
│   │   └── page.tsx           # Checkout flow
│   └── account/
│       ├── layout.tsx         # Auth-protected layout
│       ├── page.tsx           # Dashboard
│       ├── orders/
│       │   └── page.tsx       # Order history
│       └── settings/
│           └── page.tsx       # Profile settings
├── (auth)/                    # Auth layout group (no header/footer)
│   ├── login/page.tsx
│   ├── register/page.tsx
│   └── forgot-password/page.tsx
├── layout.tsx                 # Root layout (fonts, providers)
└── not-found.tsx              # Custom 404

components/
├── ui/                        # shadcn/ui components (auto-generated)
├── product/                   # Product-specific components
│   ├── ProductCard.tsx
│   ├── ProductGrid.tsx
│   ├── ProductGallery.tsx
│   └── ProductFilters.tsx
├── cart/
│   ├── CartItem.tsx
│   ├── CartSummary.tsx
│   └── CartSheet.tsx          # Slide-out mini cart
├── checkout/
│   ├── CheckoutForm.tsx
│   ├── AddressForm.tsx
│   └── PaymentForm.tsx
├── layout/
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── MobileNav.tsx
│   └── SearchBar.tsx
└── shared/
    ├── Rating.tsx
    ├── PriceDisplay.tsx
    ├── Badge.tsx
    └── EmptyState.tsx

lib/
├── api.ts                     # Backend API client (fetch wrapper)
├── utils.ts                   # Utility functions
├── constants.ts               # App-wide constants
└── validators.ts              # Zod schemas

stores/
├── cart.ts                    # Zustand cart store
└── auth.ts                    # Zustand auth store

types/
├── product.ts                 # Product interfaces
├── cart.ts                    # Cart interfaces
├── order.ts                   # Order interfaces
└── user.ts                    # User interfaces

RULES:
- Every route segment has its own loading.tsx and error.tsx
- Server Components by default; "use client" only where needed
- API client in lib/api.ts handles auth tokens, error formatting
- Zustand stores use localStorage persistence for cart
- All prices stored as integers (paise), formatted on display only
- Do not implement payment/shipping webhook receivers in frontend app routes; this backend handles provider webhooks server-side.
```

---

## 11. Anti-Patterns to Avoid

Always include these constraints in your prompts:

```
DO NOT:
- ❌ Use placeholder images from picsum, unsplash, or via.placeholder.com
- ❌ Use `any` type in TypeScript
- ❌ Use default exports
- ❌ Put "use client" on layout files
- ❌ Use useEffect for data fetching (use Server Components)
- ❌ Create inline styles
- ❌ Use px units for font sizes (use rem)
- ❌ Ignore loading and error states
- ❌ Skip aria-labels on interactive elements
- ❌ Use alert() or console.log in production code
- ❌ Import from multiple icon libraries
- ❌ Create God components (>200 lines)
- ❌ Use localStorage directly (wrap in Zustand)
- ❌ Hardcode colors (use design tokens/CSS variables)
- ❌ Ignore mobile viewport
- ❌ Use generic colors (plain red, blue, green) — use curated palette
```

### 11.1 Security Anti-Patterns (Critical)

```
SECURITY — NEVER DO:
- ❌ Store JWT tokens or auth data in localStorage/sessionStorage
- ❌ Store refresh tokens in browser storage (must be httpOnly cookie)
- ❌ Parse error.message for branching logic (use error.code only)
- ❌ Show full error details/stack traces to users
- ❌ Use eval() or new Function() with user input
- ❌ Use innerHTML or dangerouslySetInnerHTML with user content
- ❌ Inline <script> tags (use external JS files)
- ❌ Inline style= attributes (use CSS classes)
- ❌ Trust client-side permission checks alone (backend validates all)
- ❌ Call webhook endpoints from browser code
- ❌ Hardcode API URLs or secrets in client bundles
- ❌ Disable CSP for development (keep strict in all envs)
- ❌ Skip OTP challenge flow for critical ops operations
- ❌ Show plaintext secret values in admin UI
```

**Backend Security Model (June 2026):**
- ✅ Tokens stored in memory only (never localStorage)
- ✅ Refresh tokens in httpOnly, secure, sameSite=strict cookies
- ✅ Ops auth: browser-session-only (no API keys)
- ✅ CSP: `style-src 'self'` — no 'unsafe-inline'
- ✅ 5 critical ops operations require OTP challenge
- ✅ bcrypt 12 rounds for passwords
- ✅ SHA256 for token/OTP hashing
- ✅ AES-256-GCM for config secrets

---

## 12. The Iterative Refinement Workflow

### The 3-Pass Method

**Pass 1 — Structure (Skeleton)**
```
Create the layout structure and component hierarchy for [page].
Use placeholder text and gray boxes for images. Focus on:
- Correct HTML semantics
- Responsive grid layout
- Component boundaries
- Data flow (props, server/client split)
```

**Pass 2 — Polish (Design)**
```
The structure looks good. Now apply the full design:
- Replace placeholders with real design tokens
- Add proper typography hierarchy
- Apply color palette from our design system
- Add spacing, borders, shadows per our 8px grid
- Ensure mobile responsiveness at all breakpoints
```

**Pass 3 — Interactions (Animation & UX)**
```
The design is solid. Now add:
- Hover effects on interactive elements
- Page entrance animations (staggered fade-in)
- Loading skeletons for async content
- Error states and empty states
- Form validation with inline error messages
- Keyboard navigation and focus management
```

### The Review Prompt

After generation, always run this:

```
Act as a hostile code reviewer specializing in e-commerce conversion 
optimization. Review the code you just generated and identify:

1. The #1 accessibility violation
2. The #1 performance concern
3. The #1 conversion-killing UX mistake
4. Any missing loading/error states
5. Any hardcoded values that should be tokens/constants

Fix all identified issues.
```

---

## 13. Quality Assurance Prompts

### Accessibility Audit Prompt
```
Audit this component for WCAG 2.1 AA compliance:
- Check all color contrast ratios (minimum 4.5:1 for text, 3:1 for UI)
- Verify keyboard navigation (Tab, Enter, Escape, Arrow keys)
- Check all images have descriptive alt text
- Verify form inputs have associated labels
- Check focus indicators are visible
- Ensure screen reader announces dynamic content changes
- Verify touch targets are minimum 44x44px on mobile
```

### Performance Audit Prompt
```
Review this page for Core Web Vitals optimization:
- LCP: Is the largest image using priority and proper sizing?
- INP: Are click handlers fast? Any expensive renders on interaction?
- CLS: Are all images/embeds sized? Any layout shifts on load?
- Bundle size: Can any client components be converted to server?
- Are we code-splitting properly? Any unnecessary imports?
```

### SEO Audit Prompt
```
Verify this page implements all e-commerce SEO requirements:
- Dynamic metadata (title, description, og:image) per page
- JSON-LD structured data (Product, BreadcrumbList, Organization)
- Canonical URLs on all pages
- Proper heading hierarchy (single h1, logical h2-h6)
- Semantic HTML5 elements (main, nav, article, section)
- Alt text on all images
- Internal linking structure
```

---

## 14. v0.dev Specific Tips

When using Vercel's v0.dev for rapid component generation:

### Best Practices

1. **Be extremely specific about layout**
   - ❌ "Create a product page"
   - ✅ "Create a product page with image gallery on the left (55% width), product details on the right (45%), sticky on desktop. Mobile: full-width image carousel above details."

2. **Reference shadcn components by name**
   - "Use shadcn Sheet for mobile filters, shadcn Select for sorting dropdown, shadcn Skeleton for loading states"

3. **Upload your design system**
   - Use v0's "Sources" feature to upload your `tailwind.config.ts` and a design spec document

4. **Iterate in small chunks**
   - Generate the Card → refine hover effect → add badge → adjust spacing
   - NOT: generate entire page → try to fix everything at once

5. **Export and refactor**
   - v0 output is a starting point — always refactor into your project's component structure
   - Replace inline shadcn imports with your local component library
   - Extract business logic into hooks and utilities

### v0 Prompt Template

```
Create a [component] using shadcn/ui and Tailwind CSS.

Visual style: [Premium dark mode / Clean minimalist / Warm editorial]
Layout: [Describe exact layout with percentages and breakpoints]
Data shape: [Provide TypeScript interface]
Interactions: [List hover, click, and transition behaviors]
Constraints: [What NOT to do]

Reference: [Describe or upload a screenshot of similar UI you want]
```

---

## Quick Reference Card

### Starting a New Page

```
1. Define the TypeScript interfaces (types/)
2. Create loading.tsx skeleton
3. Create error.tsx boundary  
4. Build leaf components first (Card, Badge, Price)
5. Compose into sections (ProductGrid, FilterSidebar)
6. Assemble the page (Server Component, data fetching)
7. Add animations and micro-interactions
8. Run accessibility + performance audit prompts
9. Test on mobile viewport
```

### The "Make It Premium" Follow-Up

When a generated component looks too generic, use:

```
This looks functional but generic. Elevate it to premium quality:
- Refine spacing to follow an 8px grid strictly
- Improve typography hierarchy (size AND weight contrast)
- Add subtle depth with layered shadows
- Use our brand color palette instead of default Tailwind colors
- Add micro-interactions on hover/focus states
- Ensure generous whitespace — let elements breathe
- Make it feel like it belongs on a $50M revenue storefront
```

---

> **Remember:** The best AI-generated frontend is one where a human architect provides clear constraints, reviews every output, and iterates relentlessly. AI is your 10x accelerator, not your replacement.

---

> **Where does frontend build fit in the deployment sequence?** Frontend build is **Phase 4** of the client onboarding process (running simultaneously with Phase 3 provider dry-runs). Phase 5 is the mandatory full local integration testing gate — both checklists must be fully ticked against localhost before the VPS is touched. Frontend deployment is **Phase 10**. The complete ordered sequence — from client intake through DNS cutover — is in **[`docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`](docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md)**. Never ship a frontend before both checklists are fully ticked.
