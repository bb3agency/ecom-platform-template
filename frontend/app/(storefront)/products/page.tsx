import Link from "next/link";
import { Suspense } from "react";
import { Leaf, SlidersHorizontal, ChevronRight, Sparkles } from "lucide-react";
import { ProductGrid } from "@/components/product/ProductGrid";
import { PlpSortSelect } from "@/components/product/PlpSortSelect";
import { StorefrontPagination } from "@/components/product/StorefrontPagination";
import {
  fetchStorefrontProducts,
  type StorefrontProductSort,
} from "@/lib/storefront-products";

interface ProductsPageProps {
  searchParams: Promise<{
    page?: string;
    limit?: string;
    sort?: string;
    q?: string;
    category?: string;
  }>;
}

export const metadata = {
  title: "Shop Chemical Free & Natural Products",
  description:
    "Browse our full range of chemical free and natural produce, staples, and everyday essentials.",
};

const VALID_SORTS = new Set<StorefrontProductSort>([
  "newest",
  "popularity",
  "price_asc",
  "price_desc",
]);

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const limit = Math.min(48, Math.max(1, Number(params.limit ?? "16") || 16));
  const sort = VALID_SORTS.has(params.sort as StorefrontProductSort)
    ? (params.sort as StorefrontProductSort)
    : "newest";
  const q = params.q ?? "";
  const category = params.category ?? "";

  const { products, meta } = await fetchStorefrontProducts({
    page,
    limit,
    sort,
    search: q || undefined,
    category: category || undefined,
  });

  const title = q
    ? `Results for "${q}"`
    : category
      ? category.replace(/-/g, " ")
      : "Shop All Products";

  const totalPages = meta?.totalPages ?? 1;
  const totalProducts = meta?.total ?? products.length;

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f7f2] pb-16">

      {/* ── Hero Banner ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#23403d] via-[#2d5450] to-[#1a2f2e] py-12 md:py-20">
        {/* Decorative orbs */}
        <div className="absolute -top-20 right-20 size-72 rounded-full bg-[#ec6e55] opacity-10 blur-3xl" aria-hidden />
        <div className="absolute -bottom-16 -left-16 size-64 rounded-full bg-[#c5dac2] opacity-15 blur-3xl" aria-hidden />
        <div className="absolute right-1/3 top-1/4 size-40 rounded-full bg-white opacity-5 blur-2xl" aria-hidden />

        <div className="relative mx-auto flex w-full max-w-[1440px] flex-col items-center justify-center px-4 text-center lg:px-8">
          {/* Label chip */}
          <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-[#c5dac2] backdrop-blur-sm">
            <Leaf className="size-3" aria-hidden />
            100% Natural
          </span>

          <h1 className="mb-3 font-heading text-3xl font-bold capitalize text-white sm:mb-4 sm:text-5xl md:text-6xl">
            {title}
          </h1>

          {/* Breadcrumb */}
          <nav
            className="mb-6 flex items-center gap-1.5 text-xs font-semibold text-white/60 sm:gap-2 sm:text-sm"
            aria-label="Breadcrumb"
          >
            <Link href="/" className="transition-colors hover:text-[#c5dac2]">
              Home
            </Link>
            <ChevronRight className="size-3" />
            <span className="capitalize text-[#c5dac2]">
              {q ? "Search" : category ? category.replace(/-/g, " ") : "Shop"}
            </span>
          </nav>

          {/* Stats strip */}
          {totalProducts > 0 && (
            <div className="flex items-center gap-6 sm:gap-10">
              {[
                { value: `${totalProducts}+`, label: "Products" },
                { value: "100%", label: "Chemical Free" },
                { value: "Farm", label: "Direct" },
              ].map(({ value, label }) => (
                <div key={label} className="text-center">
                  <p className="text-xl font-extrabold text-white sm:text-2xl">{value}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">{label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Controls Bar ──────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[1440px] px-4 pt-6 sm:pt-10 lg:px-8">
        <div className="mb-6 flex flex-col items-start justify-between gap-3 rounded-2xl border border-white/60 bg-white px-4 py-3 shadow-sm sm:mb-8 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-4">
          {/* Results count */}
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-[#eff5ee]">
              <Sparkles className="size-3.5 text-[#ec6e55]" aria-hidden />
            </span>
            <p className="text-sm font-semibold text-[#555]">
              {products.length > 0 ? (
                <>
                  <span className="font-extrabold text-[#23403d]">{products.length}</span>
                  {" "}product{products.length !== 1 ? "s" : ""} on this page
                  {totalPages > 1 && (
                    <span className="text-[#999]"> · page {page} of {totalPages}</span>
                  )}
                </>
              ) : (
                <span className="text-[#999]">No products found</span>
              )}
            </p>
          </div>

          {/* Sort */}
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#767676]">
              <SlidersHorizontal className="size-3.5 text-[#ec6e55]" aria-hidden />
              Sort
            </span>
            <Suspense
              fallback={
                <div className="h-9 w-40 animate-pulse rounded-full bg-[#f0f0f0]" />
              }
            >
              <PlpSortSelect current={sort} />
            </Suspense>
          </div>
        </div>

        {/* Active filters */}
        {(q || category) && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-[#999]">Active filters:</span>
            {q && (
              <Link
                href={`/products?${new URLSearchParams({ sort, category }).toString()}`}
                className="flex items-center gap-1.5 rounded-full border border-[#e8ede7] bg-white px-3 py-1 text-xs font-semibold text-[#23403d] transition-colors hover:border-[#ec6e55] hover:text-[#ec6e55]"
              >
                Search: {q} ×
              </Link>
            )}
            {category && (
              <Link
                href={`/products?${new URLSearchParams({ sort, q }).toString()}`}
                className="flex items-center gap-1.5 rounded-full border border-[#e8ede7] bg-white px-3 py-1 text-xs font-semibold text-[#23403d] transition-colors hover:border-[#ec6e55] hover:text-[#ec6e55]"
              >
                {category.replace(/-/g, " ")} ×
              </Link>
            )}
            <Link
              href="/products"
              className="text-xs font-bold text-[#ec6e55] transition-colors hover:underline"
            >
              Clear all
            </Link>
          </div>
        )}

        {/* Products grid or empty state */}
        {products.length > 0 ? (
          <>
            <ProductGrid products={products} />
            <StorefrontPagination
              page={page}
              totalPages={totalPages}
              basePath="/products"
              searchParams={{ sort, q, category, limit: String(limit) }}
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-[#c5dac2] bg-white px-4 py-28 text-center shadow-sm">
            <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-[#eff5ee] to-[#dbe8d8]">
              <Leaf className="size-10 text-[#ec6e55]" aria-hidden />
            </div>
            <h2 className="mb-3 font-heading text-2xl font-bold text-[#23403d]">
              {q ? "No products matched your search" : "No active products yet"}
            </h2>
            <p className="mb-8 max-w-md text-sm font-medium text-[#767676]">
              {q
                ? "Try checking your spelling or use more general terms."
                : "Add products in the admin console and set their status to Active — they will show up here automatically."}
            </p>
            <Link
              href="/products"
              className="inline-flex h-12 items-center justify-center rounded-full bg-[#23403d] px-8 text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:bg-[#ec6e55] hover:shadow-lg"
            >
              Browse All Products
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
