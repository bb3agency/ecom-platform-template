"use client";

import { useEffect, useState } from "react";
import { getProductReviews, type Review } from "@/lib/reviews-api";
import {
  formatReviewDate,
  formatReviewerName,
} from "@/lib/review-display";
import { Rating } from "@/components/shared/Rating";

interface ProductReviewsSectionProps {
  productSlug: string;
}

export function ProductReviewsSection({ productSlug }: ProductReviewsSectionProps) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await getProductReviews(productSlug, { limit: 12 });
        if (!cancelled) {
          setReviews(Array.isArray(result.items) ? result.items : []);
        }
      } catch {
        if (!cancelled) {
          setError("We could not load reviews right now. Please try again later.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [productSlug]);

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-[#767676]" role="status">
        Loading customer reviews…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm text-[#ec6e55]" role="alert">
        {error}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <section className="mt-16 border-t border-[#efe8e4] pt-12">
        <h2 className="mb-3 font-heading text-2xl font-bold text-[#23403d]">
          Customer Reviews
        </h2>
        <p className="text-sm text-[#767676]">
          No approved reviews yet. Purchasers can leave feedback after delivery;
          approved reviews appear here automatically.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-16 border-t border-[#efe8e4] pt-12">
      <h2 className="mb-8 font-heading text-2xl font-bold text-[#23403d]">
        Customer Reviews
      </h2>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {reviews.map((review) => (
          <article
            key={review.id}
            className="rounded-2xl border border-[#efe8e4] bg-white p-6 shadow-sm"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-bold text-[#23403d]">
                  {formatReviewerName(review.author)}
                </p>
                <p className="text-xs font-medium text-[#767676]">
                  {formatReviewDate(review.createdAt)}
                </p>
              </div>
              <Rating rating={review.rating} />
            </div>
            {review.body?.trim() ? (
              <p className="text-sm font-medium leading-relaxed text-[#4a4a4a]">
                {review.body.trim()}
              </p>
            ) : (
              <p className="text-sm italic text-[#767676]">Rated without a written review.</p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
