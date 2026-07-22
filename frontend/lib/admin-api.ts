/** Admin API response shapes — aligned with backend route schemas. */

export type ShippingProviderEnum = "DELHIVERY" | "SHIPROCKET" | "LOCAL";

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  meta: PaginationMeta;
}

/** Coerce unknown API values to arrays (prevents `.filter is not a function`). */
export function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : [];
}

/** Payloads that expose a list under `items` (paginated or not). */
export type AdminItemsPayload<T> =
  | PaginatedResponse<T>
  | FlatPaginatedResponse<T>
  | T[]
  | { items?: T[] | unknown }
  | null
  | undefined;

/** Unwrap admin list endpoints that return `{ items, meta }` (or a bare array). */
export function getPaginatedItems<T>(response: AdminItemsPayload<T>): T[] {
  if (response == null) {
    return [];
  }
  if (Array.isArray(response)) {
    return response;
  }
  if (typeof response === "object") {
    const items = (response as PaginatedResponse<T>).items;
    return Array.isArray(items) ? items : [];
  }
  return [];
}

/** Read `items` from paginated list state (null-safe). */
export function readPaginatedItems<T>(data: AdminItemsPayload<T>): T[] {
  if (!data) {
    return [];
  }
  return getPaginatedItems(data);
}

const EMPTY_META: PaginationMeta = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
};

/** Normalize any admin list payload into `{ items, meta }` for hooks and tables. */
export function coercePaginatedResponse<T>(
  response: PaginatedResponse<T> | FlatPaginatedResponse<T> | T[] | unknown,
): PaginatedResponse<T> {
  const items = getPaginatedItems(
    response as
      | PaginatedResponse<T>
      | FlatPaginatedResponse<T>
      | T[]
      | null
      | undefined,
  );

  if (response && typeof response === "object") {
    if (
      "meta" in response &&
      response.meta &&
      typeof response.meta === "object"
    ) {
      return { items, meta: response.meta as PaginationMeta };
    }
    if ("page" in response && "limit" in response && "total" in response) {
      return {
        items,
        meta: normalizePagination(response as FlatPaginatedResponse<unknown>),
      };
    }
  }

  return {
    items,
    meta: {
      ...EMPTY_META,
      limit: Math.max(items.length, 1),
      total: items.length,
      totalPages: items.length > 0 ? 1 : 0,
    },
  };
}

/** Return-requests list uses flat pagination fields instead of meta. */
export interface FlatPaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export function normalizePagination(
  response: PaginatedResponse<unknown> | FlatPaginatedResponse<unknown>,
): PaginationMeta {
  if ("meta" in response && response.meta) {
    return response.meta;
  }
  const flat = response as FlatPaginatedResponse<unknown>;
  const totalPages = flat.limit > 0 ? Math.ceil(flat.total / flat.limit) : 0;
  return {
    page: flat.page,
    limit: flat.limit,
    total: flat.total,
    totalPages,
  };
}

export interface AdminOrderListItem {
  id: string;
  orderNumber: string;
  userId: string;
  status: string;
  paymentMode: string;
  subtotal: number;
  shippingCharge: number;
  discountAmount: number;
  total: number;
  createdAt: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  awbNumber: string | null;
  labelUrl: string | null;
  shipmentStatus: string | null;
  canShipNow: boolean;
  shipBlockReason: string | null;
  /** Merchant-fulfilled local delivery order — no courier is ever booked. */
  isLocalDelivery?: boolean;
  shippingMode: string;
}

export interface AdminPaymentListItem {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string | null;
  provider: string;
  method: string | null;
  status: string;
  amount: number;
  currency: string;
  providerPaymentId: string | null;
  providerOrderId: string;
  capturedAt: string | null;
  refundPendingAmountPaise: number;
  refundedAmountPaise: number;
  createdAt: string;
  updatedAt: string;
}

export type OrderBoardColumnKey =
  | "CONFIRMED"
  | "PROCESSING"
  | "SHIPPED"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";

export interface AdminBoardOrderItem {
  id: string;
  orderNumber: string;
  status: string;
  paymentMode: string;
  total: number;
  createdAt: string;
  customerName: string;
  customerPhone: string | null;
  awbNumber: string | null;
  labelUrl: string | null;
  shipmentStatus: string | null;
  canShipNow: boolean;
  shipBlockReason: string | null;
  /** Merchant-fulfilled local delivery order — no courier is ever booked. */
  isLocalDelivery?: boolean;
  shippingMode: string;
}

export interface AdminOrderBoard {
  columns: Record<OrderBoardColumnKey, AdminBoardOrderItem[]>;
}

export const ORDER_BOARD_COLUMNS: OrderBoardColumnKey[] = [
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
];

export const ORDER_FILTER_STATUSES = [
  "PENDING_PAYMENT",
  "PAYMENT_FAILED",
  "CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const;

export const PAYMENT_FILTER_STATUSES = [
  "CREATED",
  "CAPTURED",
  "FAILED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;

export const SHIPMENT_FILTER_STATUSES = [
  "PENDING",
  "BOOKED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED_DELIVERY",
  "RTO_INITIATED",
  "RTO_DELIVERED",
  "CANCELLED",
] as const;

export type DashboardKpiPeriod = "today" | "7d" | "30d" | "custom";

export const DASHBOARD_KPI_PERIODS: DashboardKpiPeriod[] = [
  "today",
  "7d",
  "30d",
  "custom",
];

export interface AdminOrderShippingAddress {
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface AdminOrderLineItem {
  id: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface AdminOrderDetailFull {
  id: string;
  orderNumber: string;
  userId: string;
  status: string;
  paymentMode: "PREPAID" | "COD";
  shippingAddress: AdminOrderShippingAddress;
  subtotal: number;
  shippingCharge: number;
  discountAmount: number;
  total: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderLineItem[];
  canShipNow: boolean;
  shipBlockReason: string | null;
  /** Merchant-fulfilled local delivery order (selectedShippingProvider = LOCAL). */
  isLocalDelivery?: boolean;
  shippingMode: string;
  customer: { name: string; email: string | null; phone: string | null };
  coupon: {
    id: string;
    code: string;
    type: string;
    value: number;
    minOrderPaise: number;
    maxUsesTotal: number | null;
    usesCount: number;
  } | null;
  payment: {
    id: string;
    provider: string;
    providerOrderId: string;
    providerPaymentId: string | null;
    amount: number;
    status: string;
    method: string | null;
    capturedAt: string | null;
    refundPendingAmountPaise: number;
    refundedAmountPaise: number;
  } | null;
  shipment: {
    id: string;
    provider: ShippingProviderEnum;
    status: string;
    awb: string | null;
    trackingUrl: string | null;
    labelUrl?: string | null;
    shipmentLabelUrl?: string | null;
    pickupScheduledDate?: string | null;
    events: Array<{
      id: string;
      status: string;
      location: string | null;
      description: string;
      occurredAt: string;
    }>;
  } | null;
  invoice: {
    invoiceNumber: string;
    hasPdf: boolean;
    issuedAt: string;
  } | null;
  packingBox?: {
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    /** Full sealed-parcel weight (grams): items + packaging. */
    weightGrams: number;
    /** The packaging (carton + tape + void fill) portion of weightGrams. */
    packagingWeightGrams: number;
    source: "catalog" | "computed" | "single-item" | "default-fallback";
    boxName: string | null;
  } | null;
}

export interface AdminOrderTimeline {
  orderId: string;
  orderNumber: string;
  currentStatus: string;
  timeline: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    triggeredBy?: string | null;
    note: string | null;
    createdAt: string;
  }>;
}

export interface AdminReturnRequestListItem {
  id: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  customerEmail: string;
  customerName: string;
  status: string;
  reason: string;
  createdAt: string;
}

export interface AdminReturnRequestItem {
  orderItemId: string;
  quantity: number;
  reason: string | null;
  productName: string | null;
  variantName: string | null;
  sku: string | null;
  unitPrice: number | null;
  orderedQuantity: number | null;
}

export interface AdminReturnRequestDetail extends AdminReturnRequestListItem {
  adminNote: string | null;
  items: AdminReturnRequestItem[];
  updatedAt: string;
}

export interface AdminProductVariant {
  id: string;
  name: string;
  sku: string;
  price: number;
  compareAtPrice: number | null;
  weight: number | null;
  packageLengthCm?: number | null;
  packageWidthCm?: number | null;
  packageHeightCm?: number | null;
  keepUpright?: boolean;
  hsnCode?: string | null;
  gstRatePercent?: number;
  isActive: boolean;
  sortOrder?: number;
}

export interface AdminProductImage {
  id: string;
  url: string;
  altText: string;
  sortOrder: number;
}

export interface AdminProductListItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  tags: string[];
  isFeatured: boolean;
  /** Merchant-fulfilled local delivery only — never couriered. See local-delivery-split.ts. */
  isLocalDeliveryOnly?: boolean;
  isActive: boolean;
  metaDescription: string | null;
  attributes?: { gstRate?: number; hsnCode?: string } | null;
  category: { id: string; name: string; slug: string };
  images: AdminProductImage[];
  variants: AdminProductVariant[];
}

export type AdminProductDetail = AdminProductListItem;

export interface AdminCreateProductInput {
  name: string;
  slug: string;
  description: string;
  categoryId: string;
  tags?: string[];
  isFeatured?: boolean;
  /** Merchant-fulfilled local delivery only — never couriered. See local-delivery-split.ts. */
  isLocalDeliveryOnly?: boolean;
  isActive?: boolean;
  metaDescription?: string;
  attributes?: { gstRate?: number; hsnCode?: string };
  images?: Array<{ url: string; altText: string; sortOrder: number }>;
  variants?: Array<{
    sku: string;
    name: string;
    price: number;
    compareAtPrice?: number;
    weight?: number;
    packageLengthCm?: number;
    packageWidthCm?: number;
    packageHeightCm?: number;
    keepUpright?: boolean;
    isActive?: boolean;
    quantity?: number;
    lowStockThreshold?: number;
  }>;
}

export interface AdminUpdateProductInput {
  name?: string;
  slug?: string;
  description?: string;
  categoryId?: string;
  tags?: string[];
  isFeatured?: boolean;
  /** Merchant-fulfilled local delivery only — never couriered. See local-delivery-split.ts. */
  isLocalDeliveryOnly?: boolean;
  isActive?: boolean;
  metaDescription?: string;
  attributes?: { gstRate?: number; hsnCode?: string } | null;
}

const PRODUCT_HSN_PATTERN = /^[0-9]{1,15}$/;

export function isValidProductHsnCode(value: string): boolean {
  return PRODUCT_HSN_PATTERN.test(value.trim());
}

export function buildProductTaxAttributes(input: {
  gstInvoicingEnabled: boolean;
  gstRate: string;
  hsnCode: string;
  existingAttributes?: Record<string, unknown> | null;
}): Pick<AdminCreateProductInput, "attributes"> {
  const trimmedHsn = input.hsnCode.trim();
  const hasGstRate =
    input.gstInvoicingEnabled && input.gstRate.trim().length > 0;

  if (!trimmedHsn && !hasGstRate) {
    return {};
  }

  const attributes: Record<string, unknown> = {
    ...(input.existingAttributes ?? {}),
  };

  if (trimmedHsn) {
    attributes.hsnCode = trimmedHsn;
  } else {
    delete attributes.hsnCode;
  }

  if (hasGstRate) {
    attributes.gstRate = Math.min(
      100,
      Math.max(0, Math.round(Number(input.gstRate))),
    );
  }

  return { attributes: attributes as AdminCreateProductInput["attributes"] };
}

/** Prefer product.attributes.hsnCode, then first variant's synced hsnCode. */
export function resolveAdminProductHsnCode(product: {
  attributes?: { hsnCode?: string } | null;
  variants?: Array<{ hsnCode?: string | null }>;
}): string {
  const fromAttributes = product.attributes?.hsnCode?.trim();
  if (fromAttributes && isValidProductHsnCode(fromAttributes)) {
    return fromAttributes;
  }
  for (const variant of product.variants ?? []) {
    const fromVariant = variant.hsnCode?.trim();
    if (fromVariant && isValidProductHsnCode(fromVariant)) {
      return fromVariant;
    }
  }
  return "";
}

export interface AdminCreateCategoryInput {
  name: string;
  slug: string;
  parentId?: string;
  imageUrl?: string;
  isActive?: boolean;
}

export interface AdminUpdateCategoryInput {
  name?: string;
  slug?: string;
  parentId?: string | null;
  imageUrl?: string | null;
  isActive?: boolean;
}

export interface AdminProductImportResult {
  createdCount: number;
  updatedCount: number;
  failedCount: number;
  errors: Array<{ line: number; message: string }>;
}

export interface AdminCategoryListItem {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserListItem {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  isBanned: boolean;
  totalOrders: number;
  totalSpendPaise: number;
  createdAt: string;
}

export interface AdminCustomerAddress {
  id: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export interface AdminCustomerOrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: number;
  shippingCharge: number;
  discountAmount: number;
  total: number;
  createdAt: string;
  shipmentStatus?: string | null;
  awb?: string | null;
}

export interface AdminCustomerProfile {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  isBanned: boolean;
  bannedAt: string | null;
  bannedReason: string | null;
  createdAt: string;
  addresses: AdminCustomerAddress[];
  orders: AdminCustomerOrderSummary[];
}

export interface AdminUserNote {
  id: string;
  userId: string;
  content: string;
  createdByAdminId: string;
  createdAt: string;
}

export interface AdminReviewListItem {
  id: string;
  userId: string;
  productId: string;
  productName: string | null;
  productSlug: string | null;
  orderId: string;
  rating: number;
  body: string | null;
  images: string[];
  approved: boolean;
  createdAt: string;
  updatedAt: string;
  author: { id: string; firstName: string; lastName: string };
}

export interface AdminCouponListItem {
  id: string;
  code: string;
  type: string;
  value: number;
  minOrderPaise: number;
  maxUsesTotal: number | null;
  maxUsesPerUser: number | null;
  usesCount: number;
  isActive: boolean;
  validFrom: string;
  validUntil: string | null;
  status: "active" | "expired" | "paused" | "deleted";
  applicableTo?: { productIds?: string[]; categoryIds?: string[] } | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminStorefrontCouponsStatus {
  merchantEnabled: boolean;
  storefrontEnabled: boolean;
  redeemableCouponCount: number;
}

export interface AdminCreateCouponInput {
  code: string;
  type: "PERCENTAGE_OFF" | "FLAT_AMOUNT_OFF" | "FREE_SHIPPING";
  value: number;
  validFrom: string;
  minOrderPaise?: number;
  maxUsesTotal?: number;
  maxUsesPerUser?: number | null;
  validUntil?: string;
  isActive?: boolean;
}

export interface AdminUpdateCouponInput {
  code?: string;
  type?: "PERCENTAGE_OFF" | "FLAT_AMOUNT_OFF" | "FREE_SHIPPING";
  value?: number;
  minOrderPaise?: number;
  maxUsesTotal?: number;
  maxUsesPerUser?: number | null;
  validFrom?: string;
  validUntil?: string | null;
  isActive?: boolean;
}

export interface AdminCouponAnalyticsItem {
  couponId: string;
  code: string;
  usesCount: number;
  totalDiscountPaise: number;
}

export interface AdminCouponAuditEntry {
  id: string;
  action: string;
  actorId: string;
  actorName: string;
  actorType: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
}

export interface AdminPaymentDetail {
  id: string;
  orderId: string;
  orderNumber: string;
  provider: string;
  method: string | null;
  status: string;
  amount: number;
  currency: string;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  capturedAt: string | null;
  refundPendingAmountPaise: number | null;
  refundedAmountPaise: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminShipmentDetail {
  id: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  provider: ShippingProviderEnum;
  status: string;
  awbNumber: string | null;
  trackingUrl: string | null;
  /** Only present for Shiprocket shipments */
  shiprocketShipmentId?: string | null;
  labelUrl: string | null;
  pickupScheduledDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBulkInventoryResult {
  updated: number;
  failed: string[];
}

export interface AdminInventoryAlertItem {
  variantId: string;
  sku: string;
  variantName: string;
  quantity: number;
  lowStockThreshold: number;
  productName: string;
  occurredAt: string;
}

export interface AdminNotificationDeliveryStats {
  channels: Array<{
    channel: string;
    total: number;
    sent: number;
    failed: number;
    deliveryRatePercent: number;
  }>;
}

/**
 * Ops-layer provider provisioning status — booleans only, no key values.
 * Computed server-side from resolveNotificationRuntimeConfig() (env + OpsConfigSecret overlay).
 * Read-only for admin; can only be changed via /ops/config.
 */
export interface NotificationProviderAvailability {
  /** true = NOTIFY_EMAIL_ENABLED is true AND RESEND_API_KEY is provisioned in ops */
  emailProvisioned: boolean;
  /** true = NOTIFY_SMS_ENABLED is true AND the active SMS provider key is provisioned in ops */
  smsProvisioned: boolean;
  /** true = NOTIFY_WHATSAPP_ENABLED is true AND META_WHATSAPP_* keys are provisioned in ops */
  whatsappProvisioned: boolean;
  /** true = OTP_WHATSAPP_ENABLED is on: signup/login OTP is ALSO sent over WhatsApp (in addition to the primary channel) */
  otpWhatsappEnabled: boolean;
  /** Active SMS provider name when smsProvisioned=true; null otherwise */
  smsProvider: "msg91" | "fast2sms" | "noop" | null;
}

export interface AdminNotificationSettings {
  emailEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  /** Per-template SET of channels (multi-channel) — a notification fans out to all of them. */
  primaryChannels: Record<string, ("EMAIL" | "SMS" | "WHATSAPP")[]>;
  smsTemplates: Record<string, string>;
  /** Ops-layer provider availability. Read-only for admin layer. */
  providerAvailability: NotificationProviderAvailability;
}

export interface AdminShipmentListItem {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  provider: ShippingProviderEnum;
  status: string;
  awbNumber: string | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  pickupScheduledDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminInventoryVariant {
  id: string;
  name: string;
  sku: string;
  product: { id: string; name: string; slug: string };
}

export interface AdminInventoryListItem {
  id: string;
  variantId: string;
  quantity: number;
  reservedQuantity?: number;
  availableQuantity?: number;
  lowStockThreshold: number;
  lowStockAlerted: boolean;
  variant: AdminInventoryVariant;
}

export interface AdminInventoryHistoryItem {
  id: string;
  delta: number;
  quantityAfter: number;
  reason: string | null;
  adminUserId: string | null;
  createdAt: string;
}

export interface AdminInventoryHistoryResponse {
  variantId: string;
  total: number;
  page: number;
  limit: number;
  items: AdminInventoryHistoryItem[];
}

export interface AdminDashboardKpis {
  period: string;
  from: string;
  to: string;
  ordersCount: number;
  revenuePaise: number;
  averageOrderValuePaise: number;
  customersCount: number;
}

export interface AdminSalesChartPoint {
  bucket: string;
  ordersCount: number;
  revenuePaise: number;
}

export interface AdminSalesChart {
  granularity: string;
  points: AdminSalesChartPoint[];
}

export interface AdminTopProductItem {
  variantId: string;
  productName: string;
  variantName: string;
  quantitySold: number;
  revenuePaise: number;
}

export interface AdminTopProducts {
  items: AdminTopProductItem[];
}

export interface AdminAnalyticsRevenue {
  granularity: string;
  points: AdminSalesChartPoint[];
}

export interface AdminAnalyticsFunnel {
  steps: Array<{
    eventType: string;
    count: number;
    conversionRatePercent: number;
  }>;
}

export interface AdminAnalyticsCategoryBreakdown {
  items: Array<{
    categoryId: string;
    categoryName: string;
    revenuePaise: number;
    sharePercent: number;
  }>;
}

export interface AdminShippingProviderStats {
  providers: Array<{
    provider: ShippingProviderEnum;
    shipmentsCount: number;
    revenuePaise: number;
    deliveredCount: number;
    sharePercent: number;
  }>;
  totalShipments: number;
}

export interface AdminReconciliationIssue {
  id: string;
  issueType: string;
  aggregateRef: string;
  isResolved: boolean;
  severity: string;
  classification: string;
  ageSeconds: number;
  resolutionAction: string;
  detectedAt: string;
  resolvedAt?: string;
}

export interface ShippingProviderAvailability {
  delhiveryConfigured: boolean;
  shiprocketConfigured: boolean;
  hasAnyProvider: boolean;
}

export interface AdminLocalDeliveryPincode {
  pincode: string;
  /** Per-pincode fee in paise; null = store default fee applies. */
  feePaise: number | null;
}

export interface AdminLocalDeliverySettings {
  enabled: boolean;
  pincodes: AdminLocalDeliveryPincode[];
  defaultFeePaise: number;
  freeAbovePaise: number | null;
  estimatedDays: number;
}

export interface AdminShippingSettings {
  pickupPincode: string;
  minOrderValuePaise: number;
  source: "database" | "environment" | "default";
  providerAvailability: ShippingProviderAvailability;
}

export interface AdminStoreProfile {
  storeName: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  gstin: string | null;
  fssaiNumber: string | null;
  sellerLegalName: string | null;
  sellerAddress: string | null;
  sellerState: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
}

export interface AdminInventorySettings {
  defaultLowStockThreshold: number;
}

export interface BoxPreset {
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** Weight of the empty carton + packing material (grams), weighed by the merchant. */
  boxWeightGrams?: number;
}

export interface AdminBoxPresetsSettings {
  presets: BoxPreset[];
  /** Flat packaging-weight override (grams). Null = automatic surface-area estimate. */
  packagingWeightGrams: number | null;
}

export function buildAdminQuery(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/** Convert YYYY-MM-DD date input to ISO range for admin export/analytics. */
export function toIsoDateRange(date: string, endOfDay = false): string {
  if (!date) return "";
  return endOfDay ? `${date}T23:59:59.999Z` : `${date}T00:00:00.000Z`;
}

export function buildOrdersExportQuery(params: {
  from: string;
  to: string;
  status?: string;
  search?: string;
  paymentMode?: string;
}): string {
  return buildAdminQuery({
    from: toIsoDateRange(params.from, false),
    to: toIsoDateRange(params.to, true),
    status: params.status,
    search: params.search,
    paymentMode: params.paymentMode,
  });
}

/** Backend admin list endpoints cap `limit` at 100 — page through for exports/KPI sums. */
export async function fetchAllPaginatedItems<T>(
  fetchPage: (page: number, limit: number) => Promise<PaginatedResponse<T>>,
  options?: { pageSize?: number; maxPages?: number },
): Promise<T[]> {
  const pageSize = options?.pageSize ?? 100;
  const maxPages = options?.maxPages ?? 100;
  const all: T[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= maxPages) {
    const response = coercePaginatedResponse<T>(
      await fetchPage(page, pageSize),
    );
    all.push(...response.items);
    totalPages = response.meta.totalPages;
    page += 1;
  }

  return all;
}

export interface AdminReviewSummary {
  averageRating: number | null;
  totalApproved: number;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
}
