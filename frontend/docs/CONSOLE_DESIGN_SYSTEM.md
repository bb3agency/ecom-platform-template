# Console design system (admin + ops)

The merchant admin (`/admin/*`) and the platform ops console (`/ops/*`) are one product
family: a neutral work surface that carries **only the client's brand colour** as its accent.
Storefronts keep each client's full theme; consoles do not.

Everything here is **core** and syncs to every client:

| Piece | File |
|---|---|
| Tokens, status colours, touch rules | `components/ui/console-theme.css` |
| Layout + data primitives | `components/ui/console.tsx` |
| This spec | `docs/CONSOLE_DESIGN_SYSTEM.md` |

The console shells put `console-theme` next to `admin-console` / `ops-console` on their root
element and import `@/components/ui/console-theme.css`. Never restyle the console from
`app/globals.css` — that file is client-owned (`merge=ours`) and changes there never sync.

## Who it is for, and the one job

A shop owner or their packer, often on a phone between packing orders, sometimes on a laptop
doing stock and settings. The console's job is to make **what needs doing next** obvious and
fast: orders to dispatch, returns to decide, stock running out. Vanity numbers come second.

## Tokens

| Role | Value | Notes |
|---|---|---|
| Canvas | `--background` ≈ `#F6F7F9` | page behind panels |
| Surface | `--card` `#FFFFFF` | panels, popovers |
| Sunken | `--muted` ≈ `#F1F3F6` | table headers, hovers, inactive chips |
| Ink | `--foreground` ≈ `#1F2533` | |
| Secondary ink | `--muted-foreground` ≈ `#667085` | 4.9:1 on canvas — the lightest text allowed |
| Hairline | `--border` ≈ `#E3E6EB`, inputs `--input` one step darker | |
| Accent | `--primary` = the client brand (`--console-brand`) | buttons, active nav, focus ring, chart series 1 |
| Status | `--success`, `--console-warning`, `--destructive`, `--console-info` | brand-independent |

Type: Inter only. Scale `text-xs` 12 (labels, column heads) · `text-sm` 14 (body, tables) ·
`text-base` 16 (panel titles) · `text-xl/2xl` 20/24 (page title). Weights 400/500/600 only.
Figures use tabular numerals (`tabular` class; table cells get it automatically).

Spacing: 4px grid. Page gutter 16 / 24 / 32 px (phone / tablet / desktop). Panel inset 16 → 20.
Gap between page sections 20 → 24. Radius: panels `rounded-xl`, controls `rounded-lg`, chips full.

**No arbitrary Tailwind values** (`text-[11px]`, `bg-[#23403d]`) and **no raw palette classes**
(`bg-emerald-100`, `text-rose-600`). Use tokens; for status tint use `Notice` / `StatusDot`, or the
`console-notice` / `console-status` classes with `data-tone`.

## Principles

1. **One surface level.** A `Panel` never sits inside another `Panel`. Group inside a panel with
   hairlines (`divide-y`, `border-t`) or spacing, not another bordered box.
2. **Borders separate, shadows float.** Shadows only on overlays (menus, dialogs, sheets).
3. **Status = dot + words.** `<StatusDot tone="warning">Awaiting payment</StatusDot>`. Show enum values
   through `humanizeEnum()` — never `PENDING_PAYMENT` on screen.
4. **Nothing widens the page.** Every flex/grid child that can hold long text gets `min-w-0`; long
   IDs/emails `break-words` or `truncate` with the full value in `title`. Tables become stacked rows
   below `md` (`DataTable` does it). Filter rows scroll sideways inside themselves on phones.
5. **Thumb reach on phones.** 40px minimum controls (console-theme enforces it on touch). Primary
   form actions sit in `StickyActions`. Primary destinations are in the bottom tab bar.
6. **Lead with the queue.** Overview screens open with what needs action (counts that link to the
   filtered list), then performance.
7. **Write like a tool, not a brochure.** Sentence case. Buttons say what happens ("Mark as shipped",
   "Save changes"). Errors say what went wrong and what to do. Empty states invite the next action.
8. **No decoration.** No icon blobs on KPI cards, no gradient washes, no eyebrow labels above every
   heading, no motion that wasn't caused by the user.

## Primitives (`@/components/ui/console`)

| Component | Use |
|---|---|
| `ConsolePage` | page body wrapper (max width + rhythm) |
| `PageHeader` | title, one-line description, breadcrumbs (detail pages only), actions, meta |
| `Panel` | the work surface; `flush` for edge-to-edge tables; `footer` for pagination |
| `StatStrip` / `Delta` / `percentChange` | KPI band, hairline-divided, values never truncate |
| `StatusDot` / `humanizeEnum` | status display |
| `Notice` | inline info/warning/danger/success messages |
| `KeyValueList` | detail fields |
| `FilterBar` / `SearchInput` / `FilterSelect` | list filtering |
| `DataTable` | table on `md+`, stacked cards on phones; `rowHref`, `mobileTitle`, `mobileCard` |
| `TableSkeleton` | loading rows |
| `FormSection` / `StickyActions` | settings-style forms |
| `Monogram` | initial avatar |

Existing `components/ui/*` primitives (`Button`, `Input`, `Select`, `Tabs`, `Dialog`, `Sheet`,
`Badge`, `EmptyState`, `ConfirmDialog`) are restyled automatically by the console tokens — use them.

## Shell

- Desktop (`lg+`): 240px sidebar (collapsible to a 64px rail), 56px top bar.
- Phone/tablet: top bar (menu, brand, search, alerts) + bottom tab bar with the 4 most used
  destinations and "More" (opens the full navigation sheet).
- `main` scrolls; the page itself never scrolls sideways.

## Verifying a screen

Render it at **375 × 812**, **768 × 1024** and **1280 × 800** and check: no horizontal scroll
(`document.documentElement.scrollWidth === innerWidth`), nothing truncated that the user needs,
primary action visible without hunting, loading / empty / error states all reachable.

## Attention banners on a record (pattern)

When a record needs the merchant to act, put a `Notice` directly under the `PageHeader`, above the work columns. Examples: a refund still owed (`AdminOrderRefundOwedNotice`, 0.4.0), or an order that cannot ship.

- `tone="warning"` while the system is still handling it on its own (e.g. retrying automatically).
- `tone="danger"` once a person must act.
- The title says what is wrong in the merchant's terms ("Refund of ₹834 hasn't reached the customer"). The body says why (the provider's reason) and what happens next.
- One action, behind the matching permission, confirmed with `useConfirm()`.

A matching count on the dashboard's *Needs attention* must link to a list filtered with the **same backend predicate**, so the number and the list always agree.
