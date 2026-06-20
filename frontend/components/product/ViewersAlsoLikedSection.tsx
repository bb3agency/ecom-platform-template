import { fetchStorefrontProducts } from "@/lib/storefront-products";
import { ProductCarousel } from "@/components/product/ProductCarousel";

interface ViewersAlsoLikedSectionProps {
  currentProductId: string;
}

export async function ViewersAlsoLikedSection({
  currentProductId,
}: ViewersAlsoLikedSectionProps) {
  const { products } = await fetchStorefrontProducts({
    limit: 10,
    sort: "popularity",
  });

  const items = products.filter((p) => p.id !== currentProductId).slice(0, 8);

  if (items.length === 0) return null;

  return (
    <section className="mt-6 rounded-[20px] bg-[#faf8f5] px-5 py-7 shadow-sm sm:mt-8 sm:px-8 sm:py-9">
      <div className="mb-6">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-widest text-[#ec6e55]">
          Trending now
        </p>
        <h2 className="font-heading text-xl font-bold text-[#23403d] sm:text-2xl">
          Viewers also liked
        </h2>
      </div>
      <ProductCarousel products={items} />
    </section>
  );
}
