import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Search, Leaf, ChevronRight, FolderOpen } from "lucide-react";
import { ProductGrid } from "@/components/product/ProductGrid";
import { StorefrontPagination } from "@/components/product/StorefrontPagination";
import { SearchInput } from "@/components/shared/SearchInput";
import { NOINDEX_METADATA } from "@/lib/seo";
import { fetchStorefrontProducts } from "@/lib/storefront-products";
import {
  fetchStorefrontCategories,
  getStorefrontCategoryImage,
  normalizeStorefrontSearchQuery,
} from "@/lib/storefront-search";

interface SearchPageProps {
  searchParams: Promise<{ q?: string; page?: string; limit?: string }>;
}

export async function generateMetadata({
  searchParams,
}: SearchPageProps): Promise<Metadata> {
  const params = await searchParams;
  const q = normalizeStorefrontSearchQuery(params.q ?? "");
  return {
    title: q ? `Results for "${q}"` : "Search Products",
    ...NOINDEX_METADATA,
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const q = normalizeStorefrontSearchQuery(params.q ?? "");
  const page = Math.max(1, Number(params.page ?? "1") || 1);
  const limit = Math.min(48, Math.max(1, Number(params.limit ?? "16") || 16));

  const [{ products, meta }, categories] = q
    ? await Promise.all([
        fetchStorefrontProducts({ search: q, page, limit, sort: "newest" }),
        page === 1 ? fetchStorefrontCategories(q) : Promise.resolve([]),
      ])
    : [{ products: [], meta: null }, []];

  const total = meta?.total ?? products.length;
  const totalPages = meta?.totalPages ?? 1;
  const title = q ? `Results for "${q}"` : "Search Products";
  const hasResults = products.length > 0 || categories.length > 0;

  return (
    <div className="flex flex-col bg-[#eff5ee] min-h-screen pb-16">
      <section className="relative overflow-hidden bg-[#dbe8d8] py-8 md:py-20">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-center px-4 text-center lg:px-8">
          <h1 className="mb-4 font-heading text-2xl font-bold capitalize text-[#23403d] sm:text-4xl md:text-5xl">
            {title}
          </h1>
          <nav
            className="flex items-center gap-2 text-xs font-bold text-[#767676] sm:text-sm"
            aria-label="Breadcrumb"
          >
            <Link href="/" className="hover:text-[#ec6e55] transition-colors">
              Home
            </Link>
            <ChevronRight className="size-3" />
            <span className="text-[#ec6e55]">Search</span>
          </nav>
        </div>
        <div
          className="absolute -bottom-16 -right-16 size-64 rounded-full bg-[#c5dac2] opacity-40 blur-3xl"
          aria-hidden
        />
        <div
          className="absolute -left-16 top-0 size-48 rounded-full bg-white opacity-40 blur-3xl"
          aria-hidden
        />
      </section>

      <section className="mx-auto w-full max-w-[1440px] px-4 pt-12 lg:px-8">
        <div className="mb-8 sm:mb-10 mx-auto max-w-2xl bg-white p-3 sm:p-4 rounded-[20px] shadow-sm">
          <SearchInput defaultValue={q} />
        </div>

        {!q ? (
          <div className="flex flex-col items-center justify-center rounded-[20px] bg-white px-4 py-24 text-center shadow-sm">
            <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-[#eff5ee]">
              <Search className="size-10 text-[#ec6e55]" aria-hidden />
            </div>
            <h2 className="mb-2 font-heading text-2xl font-bold text-[#23403d]">
              Start Searching
            </h2>
            <p className="mb-8 text-sm font-medium text-[#767676] max-w-md">
              Search by product name, SKU, or category to find farm-fresh,
              naturally grown and natural products.
            </p>
          </div>
        ) : !hasResults ? (
          <div className="flex flex-col items-center justify-center rounded-[20px] bg-white px-4 py-24 text-center shadow-sm">
            <div className="mb-6 flex size-20 items-center justify-center rounded-full bg-[#eff5ee]">
              <Leaf className="size-10 text-[#ec6e55]" aria-hidden />
            </div>
            <h2 className="mb-2 font-heading text-2xl font-bold text-[#23403d]">
              No results for &ldquo;{q}&rdquo;
            </h2>
            <p className="mb-8 text-sm font-medium text-[#767676] max-w-md">
              Try checking your spelling, use more general terms, or browse our
              categories.
            </p>
            <Link
              href="/products"
              className="inline-flex h-12 items-center justify-center rounded-full bg-[#23403d] px-8 text-sm font-bold text-white transition-transform hover:-translate-y-1 hover:bg-[#ec6e55] hover:shadow-lg"
            >
              Browse All Products
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {categories.length > 0 ? (
              <section className="rounded-[20px] bg-white p-4 shadow-sm lg:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="font-heading text-lg font-bold text-[#23403d]">
                    Categories
                  </h2>
                  <p className="text-sm font-bold text-[#767676]">
                    {categories.length} match
                    {categories.length !== 1 ? "es" : ""}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {categories.map((category) => {
                    const image = getStorefrontCategoryImage(category);
                    return (
                      <Link
                        key={category.id}
                        href={`/categories/${category.slug}`}
                        className="flex items-center gap-3 rounded-2xl border border-[#efe8e4] p-3 transition-colors hover:border-[#23403d] hover:bg-[#faf3ef]"
                      >
                        {image ? (
                          <Image
                            src={image}
                            alt=""
                            width={56}
                            height={56}
                            className="size-14 shrink-0 rounded-xl object-cover"
                          />
                        ) : (
                          <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-[#eff5ee]">
                            <FolderOpen className="size-5 text-[#23403d]" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-[#23403d]">
                            {category.name}
                          </p>
                          <p className="text-xs font-medium text-[#767676]">
                            Browse category
                          </p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {products.length > 0 ? (
              <section className="flex flex-col gap-6">
                <div className="flex justify-between items-center rounded-[20px] bg-white p-4 lg:p-6 shadow-sm">
                  <p className="text-sm font-bold text-[#767676]">
                    Found {total} product{total !== 1 ? "s" : ""}
                  </p>
                </div>
                <ProductGrid products={products} />
                <StorefrontPagination
                  page={page}
                  totalPages={totalPages}
                  basePath="/search"
                  searchParams={{ q, limit: String(limit) }}
                />
              </section>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
