"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useStoreConfig } from "@/components/providers/StoreConfigProvider";
import {
  createReview,
  getReviewableProducts,
  type ReviewableProduct,
} from "@/lib/reviews-api";
import { getApiErrorMessage } from "@/lib/error-messages";

interface OrderReviewPromptProps {
  orderId: string;
  orderStatus: string;
}

/**
 * Write-a-review surface on the customer's order detail page. Only renders for a
 * DELIVERED order when storefront reviews are enabled and the order has at least
 * one not-yet-reviewed product (verified-purchase reviews).
 */
export function OrderReviewPrompt({ orderId, orderStatus }: OrderReviewPromptProps) {
  const { reviewsEnabled } = useStoreConfig();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [products, setProducts] = useState<ReviewableProduct[]>([]);
  const [loaded, setLoaded] = useState(false);

  const active = reviewsEnabled && orderStatus === "DELIVERED" && Boolean(accessToken);

  useEffect(() => {
    let cancelled = false;
    if (!active || !accessToken) {
      setProducts([]);
      setLoaded(true);
      return;
    }
    async function load() {
      try {
        const result = await getReviewableProducts(orderId, accessToken as string);
        if (!cancelled) setProducts(result);
      } catch {
        if (!cancelled) setProducts([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [orderId, active, accessToken]);

  if (!active || !loaded || products.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4 rounded-lg border border-border p-4">
      <div>
        <h2 className="font-heading text-lg font-semibold text-[#23403d]">Rate your purchase</h2>
        <p className="text-sm text-muted-foreground">
          Your feedback helps other shoppers. Reviews appear after approval.
        </p>
      </div>
      <div className="grid gap-3">
        {products.map((product) => (
          <ProductReviewRow key={product.productId} orderId={orderId} product={product} />
        ))}
      </div>
    </div>
  );
}

function ProductReviewRow({
  orderId,
  product,
}: {
  orderId: string;
  product: ReviewableProduct;
}) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(product.alreadyReviewed);

  if (done) {
    return (
      <div className="flex items-center justify-between rounded-md border border-[#dbe8d8] bg-[#eff5ee] px-3 py-2 text-sm">
        <span className="font-medium text-[#23403d]">{product.productName}</span>
        <span className="text-xs font-semibold text-[#00aa63]">Review submitted ✓</span>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!accessToken || rating < 1) {
      setError("Please select a star rating.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createReview(
        {
          productId: product.productId,
          orderId,
          rating,
          ...(body.trim() ? { body: body.trim() } : {}),
        },
        accessToken,
      );
      setDone(true);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const activeStars = hover || rating;

  return (
    <div className="grid gap-2 rounded-md border border-border p-3">
      <p className="text-sm font-medium text-[#23403d]">{product.productName}</p>
      <div
        className="flex items-center gap-0.5"
        role="radiogroup"
        aria-label={`Rate ${product.productName}`}
      >
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            aria-label={`${value} star${value === 1 ? "" : "s"}`}
            aria-pressed={rating === value}
            onMouseEnter={() => setHover(value)}
            onMouseLeave={() => setHover(0)}
            onFocus={() => setHover(value)}
            onBlur={() => setHover(0)}
            onClick={() => setRating(value)}
            className="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec6e55]"
          >
            <Star
              className={`size-6 ${value <= activeStars ? "fill-[#ec6e55] text-[#ec6e55]" : "text-[#d8cfc9]"}`}
              aria-hidden
            />
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={2000}
        placeholder="Share your experience (optional)"
        aria-label={`Review for ${product.productName}`}
        className="min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={submitting || rating < 1}
          onClick={handleSubmit}
          className="h-9 rounded-full bg-[#23403d] px-5 text-xs font-bold text-white transition-colors hover:bg-[#ec6e55] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit review"}
        </button>
      </div>
    </div>
  );
}
