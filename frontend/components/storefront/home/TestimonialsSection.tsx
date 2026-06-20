import Link from "next/link";
import { Quote, Star } from "lucide-react";
import {
  clampReviewRating,
  formatReviewDate,
  formatReviewerInitials,
  formatReviewerName,
} from "@/lib/review-display";
import { fetchStorefrontRecentReviews } from "@/lib/storefront-reviews";
import { SectionHeading } from "./SectionHeading";

export async function TestimonialsSection() {
  const { reviews } = await fetchStorefrontRecentReviews(3);

  if (reviews.length === 0) {
    return null;
  }

  return (
    <section className="bg-[#faf8f5]">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <SectionHeading
          eyebrow="From verified buyers"
          title="Trusted by families who actually read the label."
          description="Real reviews from customers — shown only after our team approves them in admin."
          align="center"
          className="mx-auto mb-12 max-w-3xl text-center lg:mb-16"
        />

        <div className="grid gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {reviews.map((review) => {
            const name = formatReviewerName(review.author);
            const initials = formatReviewerInitials(review.author);
            const reviewDate = formatReviewDate(review.createdAt);
            const productLabel = review.productName ?? "Verified purchase";
            const stars = clampReviewRating(review.rating);
            const quote = review.body?.trim() ?? "";

            return (
              <article
                key={review.id}
                className="group relative flex flex-col gap-5 rounded-3xl border border-[#23403d]/8 bg-white p-6 shadow-[0_12px_30px_-18px_rgba(35,64,61,0.2)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-22px_rgba(35,64,61,0.28)] sm:p-7"
              >
                <div className="flex items-center justify-between">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-[#dbe8d8] text-[#23403d]">
                    <Quote className="size-5" aria-hidden />
                  </div>
                  {stars > 0 ? (
                    <div
                      className="flex items-center gap-0.5"
                      aria-label={`${stars} out of 5 stars`}
                    >
                      {Array.from({ length: stars }).map((_, i) => (
                        <Star
                          key={i}
                          className="size-4 fill-[#ec6e55] text-[#ec6e55]"
                          aria-hidden
                        />
                      ))}
                    </div>
                  ) : null}
                </div>

                <p className="flex-1 text-base leading-relaxed text-[#23403d]">
                  &ldquo;{quote}&rdquo;
                </p>

                <div className="flex items-center gap-3 border-t border-[#efe8e4] pt-5">
                  <div className="flex size-11 items-center justify-center rounded-full bg-gradient-to-br from-[#dbe8d8] to-[#ffe0d4] font-heading text-base font-bold text-[#23403d]">
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-[#23403d]">
                      {name}
                    </p>
                    <p className="truncate text-xs text-[#767676]">
                      {reviewDate ? `${reviewDate} · ` : ""}
                      {review.productSlug ? (
                        <Link
                          href={`/products/${review.productSlug}`}
                          className="font-medium text-[#23403d] underline-offset-2 hover:text-[#ec6e55] hover:underline"
                        >
                          {productLabel}
                        </Link>
                      ) : (
                        productLabel
                      )}
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
