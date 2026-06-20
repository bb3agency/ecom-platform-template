import { fetchStorefrontProducts } from "@/lib/storefront-products";
import { ProductCarousel } from "@/components/product/ProductCarousel";

interface RelatedProductsSectionProps {
  categorySlug: string;
  currentProductId: string;
  title?: string;
  subtitle?: string;
}

export async function RelatedProductsSection({
  categorySlug,
  currentProductId,
  title = "You may also like",
  subtitle = "From the same category",
}: RelatedProductsSectionProps) {
  const { products } = await fetchStorefrontProducts({
    category: categorySlug,
    limit: 10,
    sort: "newest",
  });

  const related = products.filter((p) => p.id !== currentProductId).slice(0, 8);

  if (related.length === 0) return null;

  return (
    <section className="mt-6 rounded-[20px] bg-white px-5 py-7 shadow-sm sm:mt-8 sm:px-8 sm:py-9">
      <div className="mb-6">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-[#ec6e55]">
          {subtitle}
        </p>
        <h2 className="font-heading text-xl font-bold text-[#23403d] sm:text-2xl">
          {title}
        </h2>
      </div>
      <ProductCarousel products={related} />
    </section>
  );
}
