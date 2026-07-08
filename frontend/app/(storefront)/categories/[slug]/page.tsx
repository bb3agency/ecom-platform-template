import Link from "next/link";
import { ChevronRight, Leaf } from "lucide-react";
import { ProductGrid } from "@/components/product/ProductGrid";
import { StorefrontPagination } from "@/components/product/StorefrontPagination";
import {
  fetchStorefrontCategoryProducts,
  type StorefrontProductSort,
} from "@/lib/storefront-products";

const VALID_SORTS = new Set<StorefrontProductSort>(["newest", "popularity", "price_asc", "price_desc"]);

interface CategoryProductsPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string; limit?: string; sort?: string }>;
}

function formatCategoryName(slug: string): string {
  if (slug === "spices-condiments") {
    return "Spices & Condiments";
  }
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function generateMetadata({ params }: CategoryProductsPageProps) {
  const { slug } = await params;
  const name = formatCategoryName(slug);
  return { title: `${name} — Naturally Grown Products` };
}

export default async function CategoryProductsPage({
  params,
  searchParams,
}: CategoryProductsPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const page = Math.max(1, Number(query.page ?? "1") || 1);
  const limit = Math.min(48, Math.max(1, Number(query.limit ?? "12") || 12));
  const sort: StorefrontProductSort = VALID_SORTS.has(query.sort as StorefrontProductSort)
    ? (query.sort as StorefrontProductSort)
    : "newest";
  const categoryName = formatCategoryName(slug);

  const { products, meta } = await fetchStorefrontCategoryProducts(slug, {
    page,
    limit,
    sort,
  });

  const total = meta?.total ?? products.length;
  const totalPages = meta?.totalPages ?? 1;

  return (
    <div className="flex min-h-screen flex-col bg-[#eff5ee] pb-16">
      <section className="relative overflow-hidden bg-[#dbe8d8] py-10 md:py-16">
        <div className="mx-auto w-full max-w-[1440px] px-4 lg:px-8">
          <nav
            className="mb-4 flex items-center gap-1.5 text-xs font-bold text-[#767676] sm:text-sm"
            aria-label="Breadcrumb"
          >
            <Link href="/" className="hover:text-[#ec6e55]">
              Home
            </Link>
            <ChevronRight className="size-3" />
            <Link href="/products" className="hover:text-[#ec6e55]">
              Shop
            </Link>
            <ChevronRight className="size-3" />
            <span className="text-[#ec6e55]">{categoryName}</span>
          </nav>
          <p className="text-xs font-bold uppercase tracking-widest text-[#ec6e55]">
            Naturally Grown Category
          </p>
          <h1 className="mt-1 font-heading text-3xl font-bold text-[#23403d] sm:text-4xl">
            {categoryName}
          </h1>
          <p className="mt-2 text-sm font-medium text-[#23403d]/75">
            {total > 0
              ? `${total} active product${total !== 1 ? "s" : ""}`
              : "Products in this category will appear when marked Active in admin"}
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1440px] px-4 pt-8 lg:px-8">
        {products.length > 0 ? (
          <>
            <ProductGrid products={products} />
            <StorefrontPagination
              page={page}
              totalPages={totalPages}
              basePath={`/categories/${slug}`}
              searchParams={{ sort, limit: String(limit) }}
            />
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-[#c5dac2] bg-white py-24 text-center">
            <Leaf className="size-14 text-[#23403d]/25" aria-hidden />
            <p className="font-heading text-xl font-semibold text-[#23403d]">
              No products in this category yet
            </p>
            <p className="max-w-md text-sm text-[#767676]">
              Active products assigned to this category in admin will show up here.
            </p>
            <Link
              href="/products"
              className="mt-2 inline-flex h-10 items-center justify-center rounded-full bg-[#23403d] px-6 text-sm font-bold text-white transition-colors hover:bg-[#ec6e55]"
            >
              Browse all products
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
