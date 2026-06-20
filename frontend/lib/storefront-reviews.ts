import {
  getRecentApprovedReviews,
  type Review,
  type ReviewListResponse,
} from "@/lib/reviews-api";

export type StorefrontReview = Review;

export interface StorefrontReviewsResult {
  reviews: StorefrontReview[];
  total: number;
}

function hasDisplayableBody(review: Review): boolean {
  return Boolean(review.body?.trim());
}

function normalizeReviewList(
  payload: ReviewListResponse | null | undefined,
): StorefrontReviewsResult {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const reviews = items.filter(hasDisplayableBody);
  const total =
    typeof payload?.meta?.total === "number" ? payload.meta.total : reviews.length;
  return { reviews, total };
}

/** Latest merchant-approved reviews for homepage testimonials (default: 3). */
export async function fetchStorefrontRecentReviews(
  limit = 3,
): Promise<StorefrontReviewsResult> {
  const safeLimit = Math.min(10, Math.max(1, limit));
  try {
    const payload = await getRecentApprovedReviews(safeLimit);
    return normalizeReviewList(payload);
  } catch {
    return { reviews: [], total: 0 };
  }
}
