import { Suspense } from "react";
import { ProductCardSkeleton } from "@/components/product/ProductCardSkeleton";
import { getStoreCategories } from "@/lib/categories";
import { HeroSection } from "@/components/storefront/home/HeroSection";
import { CategoryShowcase } from "@/components/storefront/home/CategoryShowcase";
import { FeaturedProducts } from "@/components/storefront/home/FeaturedProducts";
import { BestsellersSection } from "@/components/storefront/home/BestsellersSection";
import { TestimonialsSection } from "@/components/storefront/home/TestimonialsSection";
import { TestimonialsSectionSkeleton } from "@/components/storefront/home/TestimonialsSectionSkeleton";
import { FaqSection } from "@/components/storefront/home/FaqSection";
import { getPublicStoreConfig } from "@/lib/storefront-settings";
import { APP_NAME } from "@/lib/constants";

export const metadata = {
  title: `${APP_NAME} — Chemical-free produce, traceable from farm to door`,
  description:
    "Native-seed fruits, vegetables, and traditional spices from 120+ partner farmers across Telangana. Lab-tested for 300+ pesticide residues. Delivered within 48 hours.",
  openGraph: {
    title: `${APP_NAME} — Real food, grown the way your grandparents knew`,
    description:
      "Chemical-free, traceable produce direct from small farms. Lab-tested every batch.",
    type: "website",
  },
};

function ProductSectionSkeleton({
  background = "bg-white",
}: {
  background?: string;
}) {
  return (
    <section className={background}>
      <div className="mx-auto w-full max-w-[1440px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <div className="mb-10 h-12 w-2/3 max-w-md animate-pulse rounded-2xl bg-[#eff5ee]" />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="w-[220px] shrink-0">
              <ProductCardSkeleton />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default async function HomePage() {
  const [categories, storeConfig] = await Promise.all([
    getStoreCategories(),
    getPublicStoreConfig(),
  ]);

  return (
    <div className="flex flex-col bg-white">
      <HeroSection />

      <Suspense fallback={<ProductSectionSkeleton background="bg-white" />}>
        <FeaturedProducts />
      </Suspense>

      <CategoryShowcase categories={categories} />

      <Suspense fallback={<ProductSectionSkeleton background="bg-[#faf8f5]" />}>
        <BestsellersSection />
      </Suspense>

      <Suspense fallback={<TestimonialsSectionSkeleton />}>
        {storeConfig.reviewsEnabled ? <TestimonialsSection /> : null}
      </Suspense>
      <FaqSection isCodEnabled={storeConfig.isCodEnabled} />
    </div>
  );
}
