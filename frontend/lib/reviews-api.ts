import { apiClient } from "@/lib/api";

export interface ReviewAuthor {
  firstName: string;
  lastName: string;
}

function normalizeAuthor(raw: unknown): ReviewAuthor {
  if (!raw || typeof raw !== "object") {
    return { firstName: "Customer", lastName: "" };
  }
  const author = raw as Record<string, unknown>;
  return {
    firstName:
      typeof author.firstName === "string" && author.firstName.trim()
        ? author.firstName.trim()
        : "Customer",
    lastName:
      typeof author.lastName === "string" ? author.lastName.trim() : "",
  };
}

function normalizeReview(raw: unknown): Review | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) return null;

  return {
    id: row.id,
    productId: typeof row.productId === "string" ? row.productId : undefined,
    rating: typeof row.rating === "number" ? row.rating : 0,
    body: typeof row.body === "string" ? row.body : null,
    images: Array.isArray(row.images)
      ? row.images.filter((img): img is string => typeof img === "string")
      : [],
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    author: normalizeAuthor(row.author),
    productName:
      typeof row.productName === "string" ? row.productName : null,
    productSlug:
      typeof row.productSlug === "string" ? row.productSlug : null,
  };
}

function normalizeReviewListResponse(payload: unknown): ReviewListResponse {
  if (!payload || typeof payload !== "object") {
    return {
      items: [],
      meta: { page: 1, limit: 0, total: 0, totalPages: 0 },
    };
  }

  const obj = payload as {
    items?: unknown[];
    meta?: Partial<ReviewListResponse["meta"]>;
  };

  const items = Array.isArray(obj.items)
    ? obj.items
        .map(normalizeReview)
        .filter((review): review is Review => review !== null)
    : [];

  const meta = obj.meta ?? {};
  return {
    items,
    meta: {
      page: typeof meta.page === "number" ? meta.page : 1,
      limit: typeof meta.limit === "number" ? meta.limit : items.length,
      total: typeof meta.total === "number" ? meta.total : items.length,
      totalPages: typeof meta.totalPages === "number" ? meta.totalPages : 0,
    },
  };
}

export interface Review {
  id: string;
  productId?: string;
  rating: number;
  body: string | null;
  images: string[];
  createdAt: string;
  author: ReviewAuthor;
  productName?: string | null;
  productSlug?: string | null;
}

export interface ReviewListResponse {
  items: Review[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function getRecentApprovedReviews(
  limit = 3,
): Promise<ReviewListResponse> {
  const safeLimit = Math.min(10, Math.max(1, limit));
  const payload = await apiClient<unknown>(
    `/reviews/recent?limit=${safeLimit}`,
  );
  return normalizeReviewListResponse(payload);
}

export async function getProductReviews(
  productSlug: string,
  query?: { page?: number; limit?: number },
): Promise<ReviewListResponse> {
  const params = new URLSearchParams();
  if (query?.page) params.set("page", String(query.page));
  if (query?.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  const payload = await apiClient<unknown>(
    `/reviews/product/${productSlug}${qs ? `?${qs}` : ""}`,
  );
  return normalizeReviewListResponse(payload);
}

export interface CreateReviewInput {
  productId: string;
  orderId: string;
  rating: number;
  body?: string;
  images?: string[];
}

export async function createReview(
  input: CreateReviewInput,
  accessToken: string,
): Promise<Review> {
  const payload = await apiClient<unknown>("/reviews", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  });
  const review = normalizeReview(payload);
  if (!review) {
    throw new Error("Invalid review response from server");
  }
  return review;
}

export async function getMyReviews(
  accessToken: string,
  query?: { page?: number; limit?: number },
): Promise<ReviewListResponse> {
  const params = new URLSearchParams();
  if (query?.page) params.set("page", String(query.page));
  if (query?.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  const payload = await apiClient<unknown>(`/reviews/me${qs ? `?${qs}` : ""}`, {
    method: "GET",
    accessToken,
  });
  return normalizeReviewListResponse(payload);
}

export interface ReviewableProduct {
  productId: string;
  productName: string;
  productSlug: string;
  alreadyReviewed: boolean;
}

function normalizeReviewableProduct(raw: unknown): ReviewableProduct | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.productId !== "string" || !row.productId) return null;
  return {
    productId: row.productId,
    productName: typeof row.productName === "string" ? row.productName : "",
    productSlug: typeof row.productSlug === "string" ? row.productSlug : "",
    alreadyReviewed: row.alreadyReviewed === true,
  };
}

/** Products in a delivered order the customer may review (empty when reviews are off). */
export async function getReviewableProducts(
  orderId: string,
  accessToken: string,
): Promise<ReviewableProduct[]> {
  const payload = await apiClient<unknown>(
    `/reviews/eligible?orderId=${encodeURIComponent(orderId)}`,
    { method: "GET", accessToken },
  );
  const items =
    payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown[] }).items)
      ? (payload as { items: unknown[] }).items
      : [];
  return items
    .map(normalizeReviewableProduct)
    .filter((item): item is ReviewableProduct => item !== null);
}
