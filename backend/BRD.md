# Business Requirements Document (BRD)
## E-Commerce Backend Template — v2.0

> **Derived from:** `ECOM_MASTER.md` — the canonical source of truth.
> **This document does not contradict the master. If conflict exists, the master wins.**
> **Audience:** Developer (you), store owners (clients), anyone evaluating what the system must do.

**Document Type:** Business Requirements Document
**Version:** 2.0
**Status:** 🔒 Final — Locked
**Date:** April 2026
**Prepared By:** Freelance Developer — Andhra Pradesh, India
**Derived From:** `ECOM_MASTER.md`
**Related Documents:** `TRD.md` (Technical), `ECOM_MASTER.md` (Architecture)
**Primary Audience:** Developer, clients onboarded to the platform
**Scope:** All Indian e-commerce deployments using the template

---

## Table of Contents

1. [Document Purpose & Scope](#1-document-purpose--scope)
2. [Stakeholders & User Roles](#2-stakeholders--user-roles)
3. [Problem Statement](#3-problem-statement)
4. [Business Objectives](#4-business-objectives)
5. [Customer-Facing Requirements](#5-customer-facing-requirements)
6. [Store Owner Requirements — Admin Panel](#6-store-owner-requirements--admin-panel)
7. [Business Rules](#7-business-rules)
8. [Feature Flags](#8-feature-flags--what-can-be-toggled-per-client)
9. [Non-Functional Requirements](#9-non-functional-requirements)
10. [Out of Scope — v2.0](#10-out-of-scope--v20)
11. [Glossary](#11-glossary)
12. [Acceptance Criteria](#12-acceptance-criteria--phase-6-first-client-go-live)

---

## 1. Document Purpose & Scope

### 1.1 What This Document Answers

This BRD defines **what** the system must do — not how it does it. It describes the system from the perspective of the people who use it: the store owner (client), their customers, and the developer who deploys it. Every statement traces to `ECOM_MASTER.md`.

- What problems does this system solve for each type of user?
- What must a customer be able to do on the storefront?
- What must a store owner be able to do in the admin panel?
- What business rules govern pricing, orders, shipping, and refunds?
- What does success look like for each feature area?
- What is explicitly out of scope for v2.0?

### 1.2 What This Document Does Not Cover

- Implementation details (database schema, API design, code structure) → see `TRD.md`
- Architecture decisions and rationale → see `ECOM_MASTER.md`
- Per-client customisation procedures → see `ECOM_MASTER.md` §12

### 1.3 Delivery approach requirement (business risk control)

To reduce go-live regressions and shorten feedback loops, storefront/admin/ops frontend delivery for this product must follow **simultaneous build + integration** rather than UI-first deferred integration.

Business-level expectations:

- Delivery proceeds in vertical slices (contract + UI + real backend integration + validation evidence).
- Frontend slice execution order is ops/admin-first then storefront: Foundation -> Ops control plane -> Admin read -> Admin mutation -> Reliability -> Storefront.
- Ops console UI is post-login only: public `/ops/login` and `/ops/setup`; all other `/ops/*` routes require `ops_session` (layout redirects to login on `401`).
- Admin and ops critical actions are demonstrated on real endpoints before sign-off.
- Release readiness requires both frontend and backend checklist evidence, not page-complete screenshots alone.

---

## 2. Stakeholders & User Roles

The system has three categories of stakeholder, each with distinct goals and interactions.

| Stakeholder | Who They Are | Primary Goal |
|---|---|---|
| **Customer** | End user buying products from the client's storefront | Browse, find, and buy products easily with minimal friction |
| **Store Owner (Client)** | The business that hires the developer to build their store | Sell products, manage operations, and understand business performance |
| **Developer (You)** | The freelancer who builds and maintains the template and all client deployments | Deploy fast, maintain quality across clients, never build from scratch again |

---

## 3. Problem Statement

### 3.1 The Client's Problem

Small and medium Indian businesses selling food, apparel, or other products online face the same challenges: payment setup is complex, delivery tracking is manual, inventory goes out of sync, and customers are lost to friction in the checkout process. Off-the-shelf platforms (Shopify, WooCommerce) are either too expensive, too rigid, or too foreign to the Indian payment and logistics ecosystem.

### 3.2 The Developer's Problem

Building a custom e-commerce backend for each client from scratch wastes time on already-solved problems — authentication, cart logic, Razorpay webhooks, Delhivery integration, GST invoicing. Every project starts with the same foundation. Without a reusable template, quality does not compound: bugs fixed for Client 1 are repeated for Client 3.

### 3.3 The Solution

> **A private, production-grade backend template — built once, deployed per client.**
>
> Every client gets their own fully isolated instance: their own database, their own environment, their own Delhivery account, their own Razorpay keys. Nothing is shared at runtime. The developer clones the template, sets environment variables, and deploys in under 30 minutes. Every improvement to the template raises the baseline quality of all future client deployments.

---

## 4. Business Objectives

| Objective | Success Metric | Priority |
|---|---|---|
| Enable clients to sell products online with Indian payment methods | Razorpay checkout works for UPI, cards, netbanking, and wallets | Critical |
| Automate order fulfilment via Delhivery | Shipment created in Delhivery within 1 click from admin panel; AWB stored automatically | Critical |
| Reduce developer setup time per new client | New client deployed end-to-end in under 30 minutes from `git clone` to live URL | Critical |
| Provide store owners visibility into their business | Admin dashboard shows revenue, orders, top products, and inventory status in real time | High |
| Keep customer data secure and isolated per client | Zero data bleed between clients; all secrets isolated in per-client `.env` files | Critical |
| Support Indian regulatory requirements out of the box | GST-compliant PDF invoice on every confirmed order; FSSAI field for food clients | High |
| Keep operational costs predictable for the developer | 5–10 active client sites on a single mid-range VPS (4 vCPU / 8 GB RAM) | High |
| Make the template extensible for future client needs | New payment gateway or delivery partner pluggable without modifying business logic | Medium |

---

## 5. Customer-Facing Requirements

Everything the end customer can see and do on the storefront. The storefront is a separate Next.js application that calls this backend's API. These requirements describe outcomes, not implementation.

---

### 5.1 Account & Identity

#### BR-AUTH-01 — OTP Login
Customer enters their mobile number and receives a 6-digit OTP via SMS. No password required for primary login. This is the standard Indian mobile-first login experience.

#### BR-AUTH-02 — Email + Password Login
Alternative login method for customers who prefer it. Password reset is available via email OTP.

#### BR-AUTH-03 — Login Required Before Checkout
Customers can browse and build a cart without authentication, but order placement requires sign-up or login before the checkout action completes. If they log in after shopping, guest cart items are merged into their account cart — no items are lost.

#### BR-AUTH-04 — Profile Management
Customer can update their name and email from their account page.

#### BR-AUTH-05 — Address Book
Customer can save multiple delivery addresses, set one as default, and choose any saved address at checkout.

#### BR-AUTH-06 — Order History
Customer can see all past orders with status, itemised content, and tracking information via authenticated customer routes bound to their own orders.

---

### 5.2 Product Discovery

#### BR-CAT-01 — Category Navigation
Products are organised in a tree of categories and subcategories. Customer can browse by category (e.g., Snacks > Namkeen > Bhujia). All nesting depths must be navigable from the storefront.

#### BR-CAT-02 — Product Listing
Category pages show product cards with image, name, variant price (or price range if multiple variants), and an add-to-cart button. Out-of-stock products are hidden or visually greyed out.

#### BR-CAT-03 — Full-Text Search
Customer can search by product name, description, or tags. Results are ranked by relevance. Search is powered by PostgreSQL full-text search — no external search service is required.

#### BR-CAT-04 — Filters & Sorting
Customer can filter by price range, tags, and in-stock status. Can sort by price (low to high, high to low), newest, and popularity.

#### BR-CAT-05 — Product Detail Page
Product page shows all images in a gallery, full description, all variants with their price and stock availability, a variant selector, and the add-to-cart button.

#### BR-CAT-06 — Flexible Product Attributes
Product pages display category-specific information. For food: nutritional info, allergens, shelf life, FSSAI number, ingredients. For electronics: specifications, warranty. These are stored as flexible JSON attributes and displayed as configured per client — no schema change is needed to add new attribute types.

#### BR-CAT-07 — Featured Products
Admin can mark products as featured. Storefront can display a curated featured section on the homepage.

---

### 5.3 Cart & Checkout

#### BR-CART-01 — Add to Cart
Customer selects a variant and quantity and adds it to their cart. Quantity is validated against available stock before adding. Cart persists across browser sessions via secure `httpOnly` cookie and the session token is never returned in customer response payloads.

#### BR-CART-02 — Price Snapshot
The price shown in the cart is locked at the time of adding. If the admin later changes a product's price, items already in cart retain their original price. Customers are never surprised by a price change mid-checkout.

#### BR-CART-03 — Coupon / Promo Codes
Customer can enter a promo code at cart stage. The system validates the code and shows the discount applied, the updated subtotal, and any unmet conditions (e.g., minimum order value not reached) with a clear message.

#### BR-CART-04 — Pincode Serviceability Check
Before checkout, the system checks whether Delhivery can deliver to the customer's pincode. If the pincode is not serviceable, the customer is informed clearly before they can proceed.

#### BR-CART-05 — Delivery Rate Display
At cart stage, the system fetches the delivery charge from Delhivery based on total cart weight and origin/destination pincodes. The customer sees the exact delivery charge before placing the order.

#### BR-CART-06 — Cart Merge on Login
If a guest customer logs in during or after shopping, their guest cart items are merged into their account cart. Quantities are combined for duplicate variants. No items are ever lost in a merge.

#### BR-CART-07 — Order Placement
Customer reviews a complete order summary (items, delivery address, delivery charge, coupon discount, grand total) and places the order. Order creation is atomic for snapshot persistence and cart clear. Inventory availability is validated before placement, and actual decrement happens in the post-capture payment queue flow. If any item has insufficient stock at validation time, the order is rejected and no order changes are made.

### 5.4 Payment

#### BR-PAY-01 — Razorpay Checkout
After placing a prepaid order, the customer is presented with the Razorpay checkout modal. They can pay via UPI, credit/debit card, netbanking, or wallet. The amount shown matches the confirmed order total exactly.

#### BR-PAY-02 — Payment Confirmation
On successful payment, the customer is shown an order confirmation screen with their order number, a summary of items, and the expected delivery timeline. An order confirmation email and SMS are sent automatically within 60 seconds.

#### BR-PAY-03 — Payment Failure Recovery
If payment fails, the order remains in `PAYMENT_FAILED` status. The customer sees a clear failure message and a retry button. The cart is not cleared — they can attempt payment again without re-selecting items.

#### BR-PAY-04 — No Card Data Stored
The system never handles or stores raw card numbers or CVV. All card processing happens on Razorpay's PCI-compliant infrastructure. This is non-negotiable.

#### BR-PAY-05 — Cash on Delivery (COD)
When enabled by the store admin, customers can choose to pay on delivery instead of online. Selecting COD at checkout completes the order immediately in `CONFIRMED` status — no Razorpay payment step is required. COD is a toggle controlled by the admin (`isCodEnabled` in store settings). The store admin can also configure a cancellation window and seller state. Post-order fulfillment flow remains the same as prepaid: shipment is created only when admin explicitly clicks ship.

#### BR-PAY-06 — COD Collection by Admin
Once a COD order is delivered and cash collected, the admin marks the payment as collected via the admin panel. This transitions the payment record to `CAPTURED` status for reconciliation purposes. The admin may add an optional collection note.

#### BR-PAY-07 — Cancellation Window Enforcement
The store admin configures a cancellation window (in hours). Customers can only cancel their own orders within that window from order creation. After the window expires, cancellation is blocked with a clear error. The default window is 24 hours.

---

### 5.5 Post-Purchase

#### BR-POST-01 — Order Tracking
Customer can track their order from the order detail page. The tracking timeline shows each shipment event (picked up, in transit, out for delivery, delivered) with timestamp and location where available, without exposing internal linkage identifiers.

#### BR-POST-02 — Order Confirmation Email
A branded email is sent immediately on order confirmation containing the order number, itemised list, delivery address, grand total, and the GST invoice PDF as an attachment.

#### BR-POST-03 — Shipment Notifications
SMS notifications are sent at key milestones: when the order is dispatched, when it is out for delivery, and when it is delivered.

#### BR-POST-04 — Out-for-Delivery Alert
A high-priority SMS (and optional WhatsApp message if enabled) is sent the moment the shipping provider marks the order as out for delivery. This is the most time-sensitive notification in the customer journey.

#### BR-POST-05 — Order Cancellation by Customer
Customer can cancel an order while it is in `CONFIRMED` or `PROCESSING` status — before it has been shipped. If payment was already captured, a refund is initiated automatically. The customer receives a cancellation SMS and email.

#### BR-POST-06 — Product Reviews
After an order is marked `DELIVERED`, the customer can leave a star rating (1–5) and text review for each product they ordered. Reviews are only visible on the storefront after admin approval — on the product detail page and, when written body text is present, in the homepage testimonials carousel (`GET /api/v1/reviews/recent`). Only verified purchasers can review.

#### BR-POST-07 — Return Request
After an order is `DELIVERED`, the customer can submit a return request specifying which items to return, the quantity, and the reason. The system validates quantities against the original order. The admin then approves or rejects the request. Actual reverse pickup coordination and refund processing are handled in v2.1.

---

## 6. Store Owner Requirements — Admin Panel

Everything the store owner (the developer's client) can do in the admin dashboard route (for example `clientdomain.com/admin`). The admin panel is part of the same frontend application (Next.js + Refine route experience). Store owners never access the database directly.

---

### 6.1 Dashboard — Business Overview

#### BR-DASH-01 — KPI Cards
The dashboard home page displays today's revenue, this week's revenue, this month's revenue, today's order count, and the average order value. These are the first things the store owner sees when they open the panel.

#### BR-DASH-02 — Sales Chart
A line chart showing revenue over time. Store owner can switch between hourly (today), daily (last 7 or 30 days), and weekly views. This is the single most-used feature of the admin panel.

#### BR-DASH-03 — Top Products
A ranked list of the top 10 products by revenue in the selected period. Helps the store owner understand what is selling and what is not.

#### BR-DASH-04 — Low Stock Alerts Widget
A widget on the dashboard home page showing all product variants where current stock is at or below the configured low-stock threshold. Each row links directly to the inventory page for that variant.

#### BR-DASH-05 — Recent Orders Feed
A live feed of the 10 most recent orders showing order number, customer name, total, and status badge. Each row is clickable and opens the full order detail page.

---

### 6.2 Product & Catalogue Management

#### BR-PROD-01 — Create Product
Admin enters product name (slug is auto-generated but editable), selects category, writes description, optional **short description** (`metaDescription`, max 500 chars for SEO/listings), adds tags, uploads images, toggles **featured**, and sets **active or draft** (`isActive`). Products are not visible on the storefront until `isActive` is true (and in-stock per catalogue rules).

#### BR-PROD-02 — Product Variants
Admin defines one or more variants per product. Each variant has: SKU, variant name (e.g., `500g`, `Large / Red`), price in rupees, optional compare-at price for strike-through display, weight in grams (used by the active shipping provider for rate calculation), and initial stock quantity.

#### BR-PROD-03 — Product Attributes
Admin can fill flexible attributes relevant to the product type:
- **Food products:** nutritional info per 100g, allergens, shelf life in days, FSSAI number, HSN code
- **Electronics:** processor, RAM, storage, warranty period
- **Apparel:** handled via variant attributes (size, colour) — no separate attribute needed

#### BR-PROD-04 — Product Images
Admin can upload multiple raw images per product (JPEG/PNG/WebP/GIF, **max 5 MB each**) via the product editor multi-file picker, or attach external HTTPS URLs. Production uploads **automatically** sync to **Cloudflare R2** (`MEDIA_STORAGE_PROVIDER=r2`); Postgres stores the public CDN URL (`R2_PUBLIC_BASE_URL/<clientId>/products/...`). Local dev uses VPS disk (`local`) and optional `GET /api/v1/media/products/:productId/:filename`. Admin can reorder and delete images (delete removes the R2 object or legacy VPS file). Optional CDN image optimisation (resize/WebP) is an operator configuration on the Cloudflare side, not in-app transformation.

#### BR-PROD-05 — Edit, Deactivate & Permanent Delete
Admin can edit any product field at any time. **Deactivate** (soft delete) hides the product from the storefront immediately while preserving order history — reversible via restore or setting `isActive: true`. **Permanent delete** (`DELETE /api/v1/admin/products/:id/permanent`, `products:write`) removes the product row irreversibly when it has **no** order history and **no** customer reviews; hosted media and cart line items are cleared first. The admin UI labels soft delete **Deactivate** and exposes permanent delete only via a separate destructive action with confirmation.

#### BR-PROD-06 — Category Management
Admin can create and organise categories and subcategories in a tree structure. Each category has a name, a URL slug, an optional image, and an optional parent category. Nesting depth is unlimited.

#### BR-PROD-07 — Bulk CSV Import
Admin can upload a CSV file to create or update multiple products at once. Useful for initial catalogue setup when a client has hundreds of products.

---

### 6.3 Inventory Management

#### BR-INV-01 — Stock Overview
A table showing every active product variant with current quantity in stock and the configured low-stock threshold. At a glance, the store owner can see what needs to be restocked.

#### BR-INV-02 — Inline Stock Update
Admin can update the stock quantity for any variant directly in the inventory table without navigating to the product editor.

#### BR-INV-03 — Low-Stock Threshold Per Variant
Admin can set a custom low-stock threshold per variant. When stock falls to or below this number, a low-stock alert email is sent to the admin and the variant appears in the dashboard alert widget.

#### BR-INV-04 — Automatic Alert Reset
Once a variant is restocked above the threshold, the alert flag resets automatically. The next time stock falls to or below the threshold, a fresh alert is triggered. The same alert does not fire repeatedly for the same depletion event.

---

### 6.4 Order Management

#### BR-ORD-01 — Order List
A paginated table of all orders with columns for order number, customer name, order date, status badge, total, and payment method. Admin can filter by status (tab-based), date range (date picker), and search by order number or customer name.

#### BR-ORD-02 — Order Detail
Full order view showing:
- Itemised list with snapshots of product name, variant, SKU, quantity, unit price, and line total
- Customer name, phone, and email
- Delivery address (the snapshot taken at order time)
- Payment block: provider, method, status, provider order ID, provider payment ID, amount, capture timestamp
- Shipment block: AWB number, courier, tracking URL, current status, full event timeline
- Status history: every status transition with timestamp, who triggered it, and optional note
- GST invoice PDF download link (served via authenticated backend routes, not public/signed URLs)

#### BR-ORD-03 — Manual Status Update
Admin can manually move an order to a new valid status with an optional note. The note is recorded in the status history.

#### BR-ORD-05 — Create Delhivery Shipment
Admin clicks "Create Shipment" on the order detail page. The system sends the order to Delhivery's API, receives the AWB number, stores it on the shipment record, and makes the courier label PDF link available immediately. The order status moves to `PROCESSING`.

#### BR-ORD-06 — Cancel Order & Refund
Admin can cancel any order in `CONFIRMED` or `PROCESSING` status. If payment was captured, a Razorpay refund is initiated automatically. The refund amount and current status (pending, processed) are visible on the order detail page. Customer receives a cancellation SMS and email.

#### BR-ORD-07 — Re-trigger Notification
Admin can manually re-send any order notification (e.g., confirmation email, shipping SMS) from the order detail page. Used when a customer claims they did not receive a notification.

#### BR-ORD-08 — Bulk Order Export
Admin can export all orders in a selected date range to a CSV file. Used for accounting, client reporting, or offline record-keeping.

---

### 6.5 Customer Management

#### BR-CUS-01 — Customer List
A searchable, paginated list of all registered customers showing name, phone (masked — last 4 digits visible), email, total orders placed, and total spend. Admin can search by name, phone, or email.

#### BR-CUS-02 — Customer Detail
Full customer profile view showing contact information (phone masked), saved addresses, their complete order history with clickable order number links, and ban status (`isBanned`, `bannedAt`, `bannedReason`). A dedicated "Customer Orders" tab loads paginated order history via `GET /admin/users/:id/orders` without re-fetching the full detail.

#### BR-CUS-03 — Customer Account Moderation (Ban / Unban)
Admin can ban a customer account by providing a mandatory reason. A banned customer can still be viewed in admin but cannot log in or place orders. Admin can unban a customer at any time, which clears the ban record. Banning another admin account is blocked. Banning an already-banned customer is blocked. Banning does **not** automatically cancel existing in-progress orders — those must be handled separately.

API: `PATCH /admin/users/:id/ban` (ban, requires `users:write`) and `DELETE /admin/users/:id/ban` (unban, requires `users:write`).

#### BR-CUS-04 — Admin Notes on Customer Accounts
Admin can create free-text notes on any customer account for internal CRM use (e.g., "VIP — always expedite shipping", "Dispute history — double-check before refund"). Notes are tagged with the creating admin's ID and timestamp. Any admin with `users:write` can create or delete notes; any admin with `users:read` can list notes. Notes are never shown to the customer.

API: `GET /admin/users/:id/notes` (`users:read`), `POST /admin/users/:id/notes` (`users:write`), `DELETE /admin/users/:id/notes/:noteId` (`users:write`).

---

### 6.6 Promotions & Coupons

#### BR-CPN-01 — Create Coupon
Admin creates a coupon with:
- A unique code (e.g., `WELCOME10`, `FLAT50`)
- Discount type (see BR-CPN-02)
- Discount value
- Optional minimum order value (cart subtotal must reach this before the coupon applies)
- Optional per-customer usage limit (e.g., each customer can use it once)
- Optional total usage limit (e.g., first 100 redemptions only)
- Validity start and end dates
- Optional product or category scope (coupon applies only to selected products or categories)

#### BR-CPN-02 — Discount Types
Four supported discount types in v2.0:
- `PERCENTAGE_OFF` — e.g., 10% off the subtotal
- `FLAT_AMOUNT_OFF` — e.g., ₹50 off the subtotal
- `FREE_SHIPPING` — delivery charge is waived; subtotal is not affected
- `BUY_X_GET_Y` — deferred to v2.2 (see §10)

#### BR-CPN-03 — Coupon List
A table of all coupons showing code, type, value, status (active / expired / paused / deleted), redemption count vs limit, and validity window. Admin can pause, delete, or restore any coupon at any time.

#### BR-CPN-04 — Coupon Usage Analytics
Admin can see how many times each coupon has been used and the total discount amount given. This helps evaluate the ROI of promotional campaigns.

#### BR-CPN-05 — Coupon Soft Delete and Restore
Deleting a coupon never removes it from the database. The coupon is soft-deleted (`deletedAt`, `deletedBy` populated, `isActive` set to false) and excluded from active coupon lists and storefront validation. A soft-deleted coupon can be restored by admin at any time, reverting it to active state. Hard delete is not permitted.

#### BR-CPN-06 — Coupon Audit Trail
Every admin action on a coupon (create, update, pause, resume, delete, restore) creates an immutable audit log entry recording: which admin performed the action, timestamp, IP address, user agent, and before/after state with field-level diffs. Audit logs are viewable per coupon via the admin dashboard.

#### BR-CPN-07 — Coupon Admin Abuse Prevention
The system enforces per-admin rate limits on coupon mutations to prevent misconfiguration accidents and credential-compromise abuse: coupon creation is capped at 10 per minute per admin, updates at 20/min, and deletes/restores at 5/min. Exceeding the limit returns a 429 error.

---

### 6.7 Analytics

#### BR-ANL-01 — Revenue Report
Revenue over a custom date range broken down by day or week. Shown as a line chart and an accompanying data table. Exportable to CSV.

#### BR-ANL-02 — Conversion Funnel
Shows the customer drop-off at each stage of the purchase journey:
`Product Views → Add to Cart → Checkout Started → Payment Initiated → Purchase Completed`

Helps the store owner identify where customers are abandoning the process.

#### BR-ANL-03 — Category Breakdown
A pie chart showing each category's contribution to total revenue in the selected period. Helps the store owner understand which product categories drive the most sales.

#### BR-ANL-04 — Notification Delivery Rates
Shows the delivery success rate for email and SMS notifications by channel. Flags channels with high failure rates so the admin can investigate the underlying provider.

#### BR-ANL-05 — Inventory Alerts Report
A list of all low-stock alerts generated in the past 30 days with timestamp, product name, variant name, and stock level at the time of the alert.

---

### 6.8 Store Settings

#### BR-SET-01 — Store Identity
Admin can update the store name, logo, contact email, and contact phone number. These appear on transactional emails, GST invoices, and the admin panel header.

#### BR-SET-02 — GST & Regulatory Fields
Admin can update the store's GSTIN and, for food businesses, the FSSAI licence number. These appear on every GST invoice generated by the system.

#### BR-SET-03 — Notification Toggles
Admin can independently enable or disable email, SMS, and WhatsApp notifications without requiring a developer to redeploy. Disabling a channel stops all notifications on that channel.

#### BR-SET-04 — Default Low-Stock Threshold
Admin can set a global default low-stock threshold. Individual variants can override this value.

#### BR-SET-05 — Minimum Order Value
Admin can set a store-wide minimum order value. Customers cannot complete checkout if their cart subtotal is below this amount.

---

### 6.9 Operations — Queue Monitor

#### BR-OPS-01 — Background Job Visibility
Admin can view the real-time status of all background jobs across all queues: active (currently running), waiting (queued), completed, failed, and delayed. Powered by Bull Board embedded in the admin panel.

#### BR-OPS-02 — Retry Failed Jobs
Admin can retry a permanently failed job directly from the queue monitor without developer intervention. Used to recover from transient failures such as a Resend API timeout or a MSG91 outage.

#### BR-OPS-03 — Dead-Letter Inspection
Admin can inspect jobs that exhausted all retry attempts — viewing the error message and operational metadata. Sensitive payload material must be redacted/minimized by default.

---

## 7. Business Rules

Business rules are invariants the system must enforce unconditionally. They are not configurable per client. Any implementation that violates a business rule is defective.

---

### 7.1 Pricing & Money Rules

**BR-PRICE-01 — Money is stored in paise**
All prices are stored, calculated, and transmitted as integers in paise (100 paise = ₹1). Floating-point arithmetic is never used for monetary calculations anywhere in the system. The only conversion to rupees happens at the display layer.

**BR-PRICE-02 — OrderItem prices are immutable snapshots**
Prices on `OrderItem` records are locked at order creation time. If a product price is changed after an order is placed, the historical order total is never affected.

**BR-PRICE-03 — Cart price snapshot**
Cart items display the price at the time they were added. If the product price changes while the item is in the cart, the customer sees the original price until they remove and re-add the item.

**BR-PRICE-04 — Compare-at price must be higher**
The compare-at price (strike-through price) must always be strictly greater than the variant's active price if set. The admin panel enforces this at the point of saving.

---

### 7.2 Inventory Rules

**BR-INV-01 — No overselling**
An order can only be placed if every cart item has sufficient stock. Stock is decremented in the captured-payment queue stage (`process-order-update`) with guarded quantity checks. (`deduct-inventory` and `confirm-order` are thin delegation stubs that enqueue `process-order-update`; all actual inventory mutations execute inside the canonical handler.) If any item is out of stock at placement validation time, the entire order is rejected and no order changes are made. Partial orders are never created.

**BR-INV-02 — Captured-payment cancellation restores inventory**
Order cancellation restores inventory when payment is already captured. Restock is applied in the cancellation transaction for customer/admin cancellation paths to keep stock and order state consistent.

**BR-INV-03 — Low-stock alert fires once per depletion cycle**
Once a low-stock alert fires for a variant, it does not fire again until the variant is restocked above the threshold and then falls below it again.

**BR-INV-04 — Zero-stock products are hidden**
Products where all active variants have zero stock are automatically hidden from the storefront. They do not appear in search results or category pages.

---

### 7.3 Order Rules

**BR-ORD-01 — Order numbers are immutable**
An order number follows the format `ORD-YYYY-{5-digit-sequence}` and is unique per store. It cannot be changed after assignment.

**BR-ORD-02 — Cancellation window**
An order can only be cancelled while in `CONFIRMED` or `PROCESSING` status. Once a shipment is created (status `SHIPPED` or beyond), cancellation through the system is not permitted — the store owner must handle it via the shipping provider's return process.

**BR-ORD-03 — State machine is one-directional**
The order status can only move forward along the defined state machine. No backward transitions are permitted. Any attempt to make an invalid transition is rejected with an error.

**BR-ORD-04 — Every status transition is logged**
Every status change — whether triggered by a webhook, an admin action, or an automated job — is recorded in `OrderStatusHistory` with a timestamp and optional note.

**BR-ORD-05 — Shipping address is a snapshot**
The shipping address on an order is captured at order placement time. Changes to the customer's address book after order placement do not affect the delivery address for that order.

---

### 7.4 Payment Rules

**BR-PAY-01 — Webhook is the source of truth**
An order is only confirmed after the `payment.captured` webhook is received from Razorpay and the HMAC-SHA256 signature is verified on the raw request body. The frontend callback alone is never sufficient to confirm payment.

**BR-PAY-02 — Webhook idempotency**
Duplicate Razorpay webhooks for the same payment ID are silently ignored using a Redis idempotency key. An order is never double-confirmed regardless of how many times the webhook is received.

**BR-PAY-03 — Refund requires captured payment**
A refund can only be initiated if the payment status is `CAPTURED`. Refunds on pending or failed payments are not possible.

**BR-PAY-04 — Partial refunds are supported**
Partial refunds are allowed. The refund amount must not exceed the original captured amount.

### 7.5 Shipping Rules

**BR-SHIP-01 — No auto-shipping**
A shipment is only created after the admin explicitly triggers it from the order detail page. Orders are never automatically dispatched.

**BR-SHIP-02 — Weight calculation**
The total shipment weight submitted to the shipping provider is the sum of `(variant weight in grams × quantity)` for all order items. This value must be accurate — it determines the shipping charge and label.

**BR-SHIP-03 — Pincode check before order**
If a customer's delivery pincode is not serviceable by the active shipping provider, the order cannot be placed. The check happens before checkout confirmation, not after.

**BR-SHIP-04 — Pickup pincode is admin-configurable**
The pickup pincode (shipment origin) must be editable from the admin panel and takes effect for subsequent delivery-rate calculations and shipment booking. Environment fallback is allowed only as bootstrap/default.

**BR-SHIP-05 — Ship action must be eligibility-gated**
Admin ship action is enabled only when the order is in a valid shippable state (`CONFIRMED`/`PROCESSING`), payment requirements are satisfied (captured for prepaid), shipping address is complete, and shipment is not already booked.

**BR-SHIP-06 — Merchant dispatch notifications**
When an admin/merchant triggers ship action successfully, merchant dispatch notifications must be sent via enabled channels (SMS and optional WhatsApp) based on notification settings.

---

### 7.6 Coupon Rules

**BR-CPN-01 — All conditions must be met**
A coupon is valid only if all of the following are true simultaneously: it is active, the current date is within the validity window, the total usage count has not been reached, the per-customer usage limit has not been exceeded for the applying customer, the cart subtotal meets the minimum order value, and the cart contains eligible products or categories if a scope is defined. A partial match does not apply a partial discount — the coupon either applies in full or is rejected.

**BR-CPN-02 — One coupon per order**
Only one coupon can be applied per order. Stacking coupons is not supported in v2.0.

**BR-CPN-03 — Discount is on subtotal before shipping**
All discount calculations are applied to the item subtotal. A `FREE_SHIPPING` coupon sets the shipping charge to zero but does not reduce the item subtotal.

**BR-CPN-04 — Checkout reservation until finalize or release**
Usage limits count in-flight checkout orders in `PENDING_PAYMENT` and `PAYMENT_FAILED` as reserved slots (in addition to finalized `usesCount`). A slot is released on payment failure cleanup, stale checkout cancel (reconciliation), order cancel, or successful finalize (`CouponUsage` row + increment). Guest Redis per-user counters fail closed on increment errors.

---

### 7.7 GST & Invoicing Rules

**BR-GST-01 — Invoice on every confirmed order**
A GST invoice PDF is generated automatically for every confirmed order. It is attached to the order confirmation email sent to the customer.

**BR-GST-02 — Tax type by state comparison**
Tax type is determined by comparing the seller's state (from store settings) with the buyer's delivery state. Intra-state transactions use CGST + SGST (split equally). Inter-state transactions use IGST.

**BR-GST-03 — Tax rate from product attributes**
The GST rate for each line item is taken from the product's HSN code attributes. The default is 12% if not configured. The correct rate for each product category must be confirmed with the client's chartered accountant before go-live.

**BR-GST-04 — FSSAI required for food clients**
For food clients, the FSSAI licence number must appear on every invoice. If the FSSAI number is not set in store settings, the system must block invoice generation and alert the admin.

**BR-GST-05 — Sequential, non-resetting invoice numbers**
Invoice numbers are sequential per store and never reset. Format: `{PREFIX}-{YYYY}-{5-digit-seq}` (e.g., `FOOD-2026-00001`).

**BR-GST-06 — Credit notes on refunds**
When a refund is processed, the system generates a credit note referencing the original invoice number, the refunded items, and the refunded amounts.

**BR-GST-07 — Invoice generation implementation baseline**
Invoice PDF generation is executed asynchronously in backend workers using a template-composition renderer pattern (Invoicely-style React PDF approach) and the final artifact is stored on local filesystem for authenticated backend delivery.

---

### 7.8 Notification Rules

**BR-NOTIF-01 — Notifications are always async**
Notifications are never sent synchronously within an HTTP request. All notifications are dispatched via BullMQ background queues after the triggering action completes.

**BR-NOTIF-02 — Retry on failure**
A failed notification attempt is retried up to 3 times with exponential backoff (2s, 4s, 8s). After 3 failures, the job moves to the dead-letter queue and a `NotificationLog` record is created with the error message.

**BR-NOTIF-03 — Every attempt is logged**
Every notification attempt — success or failure — creates a `NotificationLog` record containing the channel, recipient, template name, status, provider, and provider response.

**BR-NOTIF-04 — Channel independence**
Email, SMS, and WhatsApp channels can be independently enabled or disabled per deployment. Disabling one channel has no effect on the others.

**BR-NOTIF-05 — Technical failure alerting**
Every technical error path (`catch` block, `log.error`/`log.warn`/`log.fatal`) across the entire system emits a structured alert via `sendTechnicalFailureAlert()` to active ops identities (`opsUser.isActive`) and verified admin users (`User.role=ADMIN`, `User.isVerified=true`). Alerts include failure stage, domain, component, error message, and client metadata. Alert delivery is best-effort via email (Resend); transport failures are silently swallowed to prevent cascading failures. Eight failure stages categorise every alert: `QUEUE_ENQUEUE`, `OUTBOX_DISPATCH`, `WORKER_TERMINAL`, `WORKER_DELIVERY`, `CORE_LOGIC`, `ROUTE_HANDLER`, `WEBHOOK_PROCESSING`, `PROVIDER_RUNTIME`.

**BR-NOTIF-06 — Per-template primary notification channel**
Each notification template (`OrderConfirmed`, `PaymentFailed`, `OrderShipped`, `OutForDelivery`, `OrderDelivered`, `OrderCancelled`, `LowStockAlert`, `OtpVerification`, `NotificationDeliveryFailure`, `PasswordReset`, `AdminInviteSetup`, `OpsInviteSetup`, `OpsActionOtp`) has a configurable primary channel (`EMAIL`, `SMS`, or `WHATSAPP`) stored in `StoreSettings.primaryNotificationChannels`. Default for all templates is `EMAIL`. Merchant admin can update per-template channel via admin settings UI. When a notification is sent via `send-primary` job, the system uses only the configured primary channel — no fallback to alternate channels. If the primary channel fails (disabled, missing credentials, or provider error), the notification fails immediately and triggers a technical failure alert.

---

## 8. Feature Flags — What Can Be Toggled Per Client

These features are built into the template but can be switched on or off per client deployment via environment variables. No code changes or redeployment of the template is needed to toggle them.

| Feature | Default | Toggle Variable | When to Enable |
|---|---|---|---|
| Promo / Coupon Codes | OFF | `FEATURE_COUPONS_ENABLED` | Enable when client wants to run promotional campaigns |
| Product Reviews & Ratings | OFF | `FEATURE_REVIEWS_ENABLED` | Enable when storefront reviews module is activated |
| Wishlist | OFF | `FEATURE_WISHLIST_ENABLED` | Enable for higher-intent categories and repeat browsing |
| Email Notifications | **ON** | `NOTIFY_EMAIL_ENABLED` | Always on — disable only without a valid domain email |
| SMS Notifications | OFF | `NOTIFY_SMS_ENABLED` | Enable after configuring MSG91 or Fast2SMS credentials in Ops UI; single primary channel enforced in admin notification settings |
| WhatsApp Notifications | OFF | `NOTIFY_WHATSAPP_ENABLED` | Enable once client has a verified WhatsApp Business account |
| GST Invoicing | **ON** | `FEATURE_GST_INVOICING_ENABLED` | Always on for GST-registered Indian businesses |
| Response Envelope | OFF | `FEATURE_RESPONSE_ENVELOPE_ENABLED` | Wraps all 2xx JSON responses in `{ success, data, meta? }` format. Enable when frontend expects standardized envelope. |

---

## 9. Non-Functional Requirements

These requirements govern how the system behaves — quality attributes every deployment must meet regardless of client or product category.

### 9.1 Reliability

- The system must remain operational during Razorpay webhook retries. If the server is temporarily unavailable, Razorpay will retry. The idempotency mechanism ensures the payment is processed exactly once on recovery.
- Background job failures must not cause silent data loss. Failed jobs must be visible in the queue monitor and retryable by the admin.
- A database backup must be scheduled daily for every client deployment, stored off the VPS (Backblaze B2 or S3-compatible).
- The system must recover from a full container restart within 60 seconds via Docker's `restart: unless-stopped` policy.

### 9.2 Performance

| Scenario | Target |
|---|---|
| Product listing (cached) at P95 | < 80ms |
| Product listing (uncached) at P95 | < 250ms |
| Order placement at P99 | < 1000ms |
| Webhook response time at all times | < 200ms |
| Admin dashboard KPIs at P95 | < 500ms |
| Concurrent users per client instance | 200 without degradation |
| Max client sites on 4 vCPU / 8 GB VPS | 10 |

### 9.3 Security

- No client's data is ever accessible by another client. Separate database, Redis, environment, and API keys per client.
- On shared VPS deployments, Redis remains private to each client Docker network; publishing host `:6379` for each stack is forbidden.
- Payment card data never passes through or is stored on the backend. Razorpay handles all card processing.
- Bootstrap secrets exist only in per-client `.env` / deployment secret stores and are never committed to any Git repository. Ops-editable non-bootstrap secrets are encrypted in DB and applied after restart. Production merchant admin provisioning is invite-only; legacy local seed scripts are not go-live provisioning paths.
- All traffic is HTTPS. Nginx redirects HTTP to HTTPS. TLSv1.0 and TLSv1.1 are disabled. Nginx HTTPS server blocks include mandatory security headers: HSTS (2yr + preload), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy strict-origin-when-cross-origin, X-XSS-Protection.
- Rate limiting is applied at both the Nginx edge layer and the Fastify application layer. All admin routes include load-shed guards and dedicated rate limiting profiles.
- All JSON Schema `type: 'object'` declarations enforce `additionalProperties: false` to prevent property injection attacks (only webhook header schemas intentionally allow additional properties).
- `JWT_SECRET` and `JWT_REFRESH_SECRET` fail fast with explicit errors if missing or empty — no silent `undefined` propagation.
- Fresh admin users are fail-closed by default: no `AdminPermissionGrant` rows means no effective privileged permissions until explicitly provisioned.
- Admin permission changes are not retroactive on already-issued access tokens; immediate grant/revoke effect requires token revocation/logout.
- Admin-triggered `REFUNDED` order status is asynchronous via queue worker confirmation; immediate API response may continue to show the pre-refund status until provider-confirmed completion.
- **TOCTOU race condition prevention:** All critical state transitions (invite consumption, refresh token rotation, reconciliation, webhook inbox claiming, idempotency first-write, inventory stock update, low-stock alert dispatch, outbox event enqueue, coupon `usesCount` increment, admin MFA enable/disable) use atomic Compare-And-Swap patterns via Prisma `updateMany` with guard conditions. Concurrent identical requests result in exactly one successful state change; subsequent attempts receive `409 CONFLICT`. Worker replicas cannot produce duplicate low-stock alerts or duplicate outbox event publishes.
- **SQL injection prevention:** Repository-wide sweep eliminated all `prisma.$executeRawUnsafe` and `prisma.$queryRawUnsafe` usage. All raw SQL queries use parameterized tagged-template literals (`prisma.$executeRaw\`...\`` / `prisma.$queryRaw\`...\``) with Prisma's template variable interpolation. CI gate `security:sql-injection-guard` fails build if unsafe patterns are introduced.
- **Audit chain tamper-evidence:** `OpsAuditLog` and `CouponAuditLog` hash chains are protected by Redis distributed locks during concurrent write operations, ensuring linear chain integrity even under concurrent ops mutations.
- **Dual approval removed:** Ops load-shed mode changes are applied immediately via `POST /ops/load-shed` after OTP verification. There is no separate approval queue or second-operator confirm step.
- **Persistent maintenance mode (May 2026):** Ops can switch the platform into a fourth load-shed mode `maintenance`, with two phases — a 2-minute `pending` warning window (storefront banner countdown, payments-in-flight allowed to settle, all new checkout/admin writes blocked) followed by `active` (Nginx serves a static maintenance page for every non-ops, non-health, non-webhook route). State lives in a single-row `MaintenanceState` Postgres table (source of truth) with a Redis cache; the mode persists across Redis flushes, container restarts, and database failovers, and exits only when an ops user explicitly switches to another mode (OTP required). `LOAD_SHED_MODE` env var cannot force `maintenance`. The Nginx edge cutover uses an `auth_request` subrequest to `/api/v1/maintenance/gate`, which returns `401 Unauthorized` when maintenance is active and the path is blocked (200 otherwise); each gated `location` catches the 401 via `error_page 401 = @maintenance_block` and returns 503, which flows into the existing `error_page 502 503 /maintenance.html`. An earlier 200-with-`X-Maintenance-Active`-header design was structurally broken (the `if` directive runs in Nginx's REWRITE phase before `auth_request` populates the variable) and was replaced on 2026-05-26 — see `docs/DECISIONS.md` "[2026-05-26] Maintenance gate switches to 401 + error_page" and `docs/HARDENING_HISTORY.md` "Maintenance gate bypass".

### 9.4 Scalability

- Any module can be extracted into a separate service if a client outgrows the VPS. The interfaces are already defined — no architectural rework is needed.
- Adding a new client to the VPS is a scripted, repeatable operation. The template codebase is never modified per client.
- New payment gateways and delivery partners can be added without touching existing business logic.
- Multi-client Nginx onboarding is additive: each domain gets its own site file/symlink; existing site entries are never removed blindly during new-client rollout.

### 9.5 Maintainability

- The template is versioned independently from client deployments. Improvements are applied to active client repos as deliberate, reviewed changes — never automatically.
- Each client deployment can be restarted, rolled back, or migrated independently of all others.
- The admin panel requires no developer involvement for day-to-day operations: products, orders, inventory, coupons, and settings are all self-serve.
- Frontend production bootstrap remains template-driven: `frontend/.env.production.example` must exist in source control and be copied to VPS runtime `.env.production.local` before first PM2 deploy.

---

## 10. Out of Scope — v2.0

The following features are explicitly not included in v2.0. They are documented in `ECOM_MASTER.md` §14 and may be added in future versions.

| Feature | Why Excluded from v2.0 | Planned |
|---|---|---|
| **Abandoned Cart Recovery** | Requires analytics event tracking and timed outreach — best calibrated after go-live data exists | v2.1 |
| **Return & Exchange Flow — Reverse Pickup + Refund** | Structured return request workflow is implemented (v2.0). Reverse pickup API integration and automated refund on return approval are deferred. | v2.1 |
| **WhatsApp Commerce (full)** | Hook is wired and interface defined. Requires client to have a verified WhatsApp Business account set up. | v2.1 |
| **Subscription / Recurring Orders** | Requires payment schedule management and repeat billing — no immediate client need | v3.0 |
| **Referral Program** | Credit wallet and referral tracking require additional DB models and UI | v3.0 |
| **Delivery Slot Selection** | Feature-flagged and interface-ready. Full UI deferred until a client with this need is onboarded. | v2.2 |
| **Multi-Warehouse Inventory** | Zone-based stock allocation — only relevant for clients with multiple fulfilment locations | v3.0 |
| **Stripe Payment Adapter** | Not needed for Indian clients. Interface is ready — implementation deferred until international need arises. | v3.0 |
| **Prometheus + Grafana full-stack rollout** | Metrics endpoint and alert artifacts are shipped in backend; full Grafana/Alertmanager stack provisioning remains optional per client infra maturity. | v3.0 |
| **Buy X Get Y Coupons** | Complex cart-level product matching logic. Percentage and flat discounts cover most client needs. | v2.2 |

### 10.1 Implemented vs Roadmap Boundary (Operational)

- **Implemented now:** queue-backed notifications, replay governance endpoints with redacted replay diagnostics, SLO rule artifacts, flash-sale drill scripts, DR drill scripts, release-policy scripts, and CI-enforced reliability/security gates.
- **Roadmap/ops rollout:** organization-specific Prometheus datasource wiring, production DR infrastructure hook commands, and per-client Grafana/Alertmanager provisioning.
- **Policy:** roadmap items are not assumed active until explicitly enabled by deployment configuration and validated with runtime evidence artifacts.

---

## 11. Glossary

| Term | Definition |
|---|---|
| **AWB** | Air Waybill — the unique tracking number assigned to a shipment by Delhivery. |
| **Paise** | The smallest unit of Indian currency. 100 paise = ₹1. All monetary values in the system are stored as integers in paise. |
| **GSTIN** | Goods and Services Tax Identification Number — the unique identifier for a GST-registered business in India. |
| **FSSAI** | Food Safety and Standards Authority of India — the regulatory body for food businesses. Their licence number is legally required on food product invoices. |
| **HSN Code** | Harmonised System of Nomenclature — an internationally standardised product classification system used to determine GST rates in India. |
| **CGST** | Central Goods and Services Tax — the central government's share of GST on intra-state transactions. |
| **SGST** | State Goods and Services Tax — the state government's share of GST on intra-state transactions. |
| **IGST** | Integrated Goods and Services Tax — the unified GST on inter-state transactions. Replaces the CGST+SGST split. |
| **IRP** | Invoice Registration Portal — the government portal where businesses with annual turnover above ₹5 Crore must upload e-invoices to receive an IRN (Invoice Reference Number). |
| **Adapter Pattern** | A design pattern used throughout the system. TypeScript interfaces under `src/common/interfaces/` define contracts (e.g. `PaymentProviderAdapter` for payments, `ShippingProviderAdapter` for logistics); concrete adapters implement them for each provider (Razorpay, Delhivery, Shiprocket, Resend, MSG91). Swapping the active provider is done via environment variables without changing call sites. |
| **Modular Monolith** | An architecture pattern where the application runs as a single process but is internally organised into fully decoupled modules that communicate only through defined interfaces. |
| **Price Snapshot** | The price of a product variant captured and frozen at the time a customer adds it to their cart or places an order. Prevents price changes from affecting in-progress transactions. |
| **Feature Flag** | An environment variable that enables or disables a feature module without code changes or redeployment. |
| **BullMQ** | The background job queue library used for async processing. Jobs are stored in Redis and processed by workers within the same Fastify process. |
| **Dead-Letter Queue** | The queue where permanently failed jobs (those that exceeded the maximum retry count) are held for inspection and manual retry. |
| **AOV** | Average Order Value — the mean value of all orders in a given period. A key business metric on the admin dashboard. |
| **RTO** | Return to Origin — when the shipping provider is unable to deliver an order and returns it to the seller's pickup address. |
| **COD** | Cash on Delivery — a payment mode where the customer pays in cash at the time of delivery. The order is confirmed immediately at checkout without an online payment step. |
| **PaymentMode** | Enum on the Order model: `PREPAID` (online payment via Razorpay) or `COD` (cash on delivery). |
| **CodPaymentAdapter** | The payment adapter used when `PAYMENT_PROVIDER=cod`. Implements `PaymentProviderAdapter` but skips online payment creation and always returns `true` for signature verification. |
| **Cancellation Window** | A configurable time limit (in hours, stored in `StoreSettings.cancellationWindowHours`) within which a customer may cancel their own order. Enforced by `cancelMyOrder` in `OrdersService`. |
| **ReturnRequest** | A database model representing a customer's post-delivery request to return one or more items. Has a structured status lifecycle: `REQUESTED → APPROVED / REJECTED → COMPLETED`. |

---

## 12. Acceptance Criteria — Phase 6 (First Client Go-Live)

The template is considered production-ready and the first client deployment is accepted when **all** of the following pass in a live environment with real API credentials.

Execution evidence for this section must include:
- `docs/BACKEND_GO_LIVE_CHECKLIST.md` (full backend env-to-implementation parity)
- `docs/FRONTEND_AI_GO_LIVE_CHECKLIST.md` (frontend integration contract verification)
- `docs/THIRD_PARTY_INTEGRATIONS_SETUP_AND_KEY_MANAGEMENT_GUIDE.md` (provider onboarding, dry-run, rotation, incident drill runbook)
- `docs/CLIENT_INTEGRATION_CREDENTIAL_REGISTER_TEMPLATE.md` (per-client owner/vault/lifecycle register)

| # | Acceptance Test | Pass Condition |
|---|---|---|
| AC-01 | Customer OTP login | Customer enters phone, receives OTP via MSG91, enters OTP, receives JWT access token and is logged in. |
| AC-02 | Guest cart to logged-in cart merge | Guest adds item without logging in, then logs in — item appears correctly in the logged-in cart. |
| AC-03 | Pincode serviceability check | A Delhivery-serviceable pincode returns delivery rate options. An unserviceable pincode is rejected before checkout with a clear message. |
| AC-04 | Prepaid order — full flow | Customer adds item, applies coupon, checks out, pays via Razorpay (UPI or card), receives order confirmation SMS and email within 60 seconds, GST invoice PDF is attached to the email. |
| AC-05 | Payment webhook idempotency | Sending the same `payment.captured` webhook payload twice results in exactly one order confirmation and one invoice — not two. |
| AC-06 | Prepaid order lifecycle integrity | Order remains `PENDING_PAYMENT` before capture, transitions via webhook-driven flow, and never bypasses payment confirmation. |
| AC-07 | Insufficient stock rejection | Attempting to order more than available stock returns `INSUFFICIENT_STOCK` error. No order is created, no inventory is decremented. |
| AC-08 | Delhivery shipment creation | Admin clicks "Create Shipment" on a confirmed order. AWB number appears on the order detail page within 10 seconds. Shipment is visible in Delhivery's dashboard. |
| AC-09 | Shipment tracking | Authenticated customer order tracking view shows correct shipment events for customer-owned orders after a Delhivery status webhook is received and processed. |
| AC-10 | Order cancellation + refund | Admin cancels a prepaid, confirmed order. Razorpay refund is initiated automatically. Order status moves to `REFUNDED`. Customer receives cancellation SMS and email. |
| AC-11 | Low stock alert | Setting a variant's stock quantity to 0 triggers a low-stock alert email to the admin. The variant appears in the dashboard low-stock widget. |
| AC-12 | GST invoice accuracy | Invoice PDF contains: correct seller GSTIN and FSSAI (for food client), correct buyer state, line items with HSN codes, correct tax type (CGST+SGST for intra-state or IGST for inter-state), and grand total matching the confirmed order total exactly. |
| AC-13 | Admin dashboard KPIs | Revenue, order count, and AOV on the dashboard match the manually calculated sum of `CONFIRMED + PROCESSING + SHIPPED + DELIVERED` orders for the selected period. |
| AC-14 | Client isolation | Placing an order on Client 1's domain does not appear in Client 2's admin panel. Client 1's API keys and database are not accessible from Client 2's environment. |
| AC-15 | New client deployment time | A second client can be fully deployed (from `git clone` to live HTTPS URL with working Razorpay checkout) in under 30 minutes. |
| AC-16 | COD order — full flow | `PATCH /api/v1/admin/settings/cod` sets `isCodEnabled: true`. Customer places order with `paymentMode: COD` → order returns `CONFIRMED` immediately with no Razorpay step. Admin triggers shipment → Shiprocket API receives `payment_method: "COD"`. On delivery, Shiprocket's agent collects cash; Shiprocket fires `delivered` webhook → backend auto-marks `Payment.status = CAPTURED`. Merchant does nothing for collection. |
| AC-17 | Cancellation window enforcement | Admin sets `cancellationWindowHours: 1`. Customer attempts to cancel an order placed more than 1 hour ago → receives `409 INVALID_STATUS_TRANSITION` error. |
| AC-18 | Return request submission | Customer submits `POST /orders/:id/return-requests` for a `DELIVERED` order → return request is created with status `REQUESTED`. Admin approves via `PATCH /admin/return-requests/:id` → status becomes `APPROVED`. |

---

*This BRD is derived from `ECOM_MASTER.md` and does not contradict it.*
*Implementation details for every requirement above are specified in `TRD.md`.*
*Development begins Phase 1. First code: `prisma/schema.prisma` + Fastify bootstrap.*

---

> **Deploying for a client?** The AC-01–AC-18 acceptance criteria are validated during Phase 11 (go-live validation) of the client onboarding process. The full sequenced runbook that gets you to that gate — covering infra provisioning, secret management, domain/TLS wiring, frontend build, and validation — is **[`docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md`](docs/CLIENT_ONBOARDING_EXECUTION_ORDER.md)**.

> **Phase 7 deployment reliability note:** Use **[`docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md`](docs/PHASE7_VPS_DEPLOY_INCIDENT_PLAYBOOK.md)** as mandatory troubleshooting context for VPS backend bootstrap/startup failures.
