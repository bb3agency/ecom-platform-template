export type CreateReviewInput = {
  productId: string;
  orderId: string;
  rating: number;
  body?: string;
  images?: string[];
};

export type ReviewListQuery = {
  page?: number;
  limit?: number;
};

export type RecentApprovedReviewsQuery = {
  limit?: number;
};

export type AdminReviewListQuery = {
  approved?: boolean;
  ratingLte?: number;
  ratingGte?: number;
  /** Full-text search on reviewer name or review body */
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};

export type ModerateReviewInput = {
  approved: boolean;
};
