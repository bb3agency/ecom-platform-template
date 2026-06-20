import { fetchStorefrontProducts } from "@/lib/storefront-products";
import { ProductCarousel } from "@/components/product/ProductCarousel";
import { SectionHeading } from "./SectionHeading";

export async function BestsellersSection() {
  const { products } = await fetchStorefrontProducts({
    limit: 10,
    sort: "popularity",
  });

  if (products.length === 0) return null;

  return (
    <section className="bg-[#faf8f5]">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <SectionHeading
          eyebrow="Customer favourites"
          title="What everyone's reordering."
          description="Our most-loved staples — ranked by repeat orders, not by paid placement."
          cta={{ label: "View bestsellers", href: "/products?sort=popularity" }}
          className="mb-10 lg:mb-12"
        />
        <ProductCarousel products={products.slice(0, 10)} />
      </div>
    </section>
  );
}
