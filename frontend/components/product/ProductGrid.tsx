import type { Product } from "@/types/product";
import { ProductCard } from "@/components/product/ProductCard";
import { EmptyState } from "@/components/shared/EmptyState";

interface ProductGridProps {
  products: Product[];
}

export function ProductGrid({ products }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <EmptyState
        title="No products found yet"
        description="Try changing filters or search terms."
      />
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {products.map((product, i) => (
        <ProductCard key={product.id} product={product} priority={i < 4} />
      ))}
    </div>
  );
}
