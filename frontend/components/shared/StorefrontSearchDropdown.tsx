"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ChevronRight,
  FolderOpen,
  Loader2,
  Package,
} from "lucide-react";
import { PriceDisplay } from "@/components/shared/PriceDisplay";
import {
  buildStorefrontSearchPath,
  getStorefrontCategoryImage,
  getStorefrontProductImage,
  getStorefrontProductPrice,
  hasStorefrontSearchResults,
  normalizeStorefrontSearchQuery,
  type StorefrontSearchResults,
} from "@/lib/storefront-search";
import { cn } from "@/lib/utils";

interface StorefrontSearchDropdownProps {
  query: string;
  results: StorefrontSearchResults | null;
  loading: boolean;
  onNavigate?: () => void;
  className?: string;
}

export function StorefrontSearchDropdown({
  query,
  results,
  loading,
  onNavigate,
  className,
}: StorefrontSearchDropdownProps) {
  const trimmed = normalizeStorefrontSearchQuery(query);
  const searchHref = buildStorefrontSearchPath(trimmed);

  if (loading && !results) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-2xl border border-[#efe8e4] bg-white py-8 shadow-xl",
          className,
        )}
      >
        <Loader2 className="size-5 animate-spin text-[#ec6e55]" aria-hidden />
        <span className="sr-only">Searching catalog</span>
      </div>
    );
  }

  if (!results) {
    return null;
  }

  if (!hasStorefrontSearchResults(results) && !loading) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-[#efe8e4] bg-white px-4 py-6 text-center shadow-xl",
          className,
        )}
      >
        <p className="text-sm font-medium text-[#767676]">
          No products or categories found for &ldquo;{trimmed}&rdquo;
        </p>
        <Link
          href={searchHref}
          onClick={onNavigate}
          className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-[#ec6e55] hover:text-[#23403d]"
        >
          View search page <ArrowRight className="size-3.5" />
        </Link>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "max-h-[min(24rem,70vh)] overflow-y-auto rounded-2xl border border-[#efe8e4] bg-white shadow-xl",
        className,
      )}
      role="listbox"
      aria-label="Search suggestions"
    >
      {results.categories.length > 0 ? (
        <section>
          <div className="flex items-center justify-between border-b border-[#efe8e4] px-4 py-2">
            <p className="text-xs font-bold uppercase tracking-wide text-[#767676]">
              Categories
            </p>
            <Link
              href={searchHref}
              onClick={onNavigate}
              className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#ec6e55] hover:text-[#23403d]"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          <ul>
            {results.categories.map((category) => {
              const image = getStorefrontCategoryImage(category);
              return (
                <li key={category.id}>
                  <Link
                    href={`/categories/${category.slug}`}
                    onClick={onNavigate}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#faf3ef]"
                    role="option"
                  >
                    {image ? (
                      <Image
                        src={image}
                        alt=""
                        width={40}
                        height={40}
                        className="size-10 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#eff5ee]">
                        <FolderOpen className="size-4 text-[#23403d]" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-[#23403d]">
                        {category.name}
                      </p>
                      <p className="text-xs font-medium text-[#767676]">
                        Browse category
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-[#767676]" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {results.products.length > 0 ? (
        <section>
          <div className="flex items-center justify-between border-b border-[#efe8e4] px-4 py-2">
            <p className="text-xs font-bold uppercase tracking-wide text-[#767676]">
              Products
            </p>
            <Link
              href={searchHref}
              onClick={onNavigate}
              className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#ec6e55] hover:text-[#23403d]"
            >
              View all <ArrowRight className="size-3" />
            </Link>
          </div>
          <ul>
            {results.products.map((product) => {
              const price = getStorefrontProductPrice(product);
              const image = getStorefrontProductImage(product);
              return (
                <li key={product.id}>
                  <Link
                    href={`/products/${product.slug}`}
                    onClick={onNavigate}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[#faf3ef]"
                    role="option"
                  >
                    {image ? (
                      <Image
                        src={image}
                        alt=""
                        width={40}
                        height={40}
                        className="size-10 shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#eff5ee]">
                        <Package className="size-4 text-[#23403d]" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-[#23403d]">
                        {product.name}
                      </p>
                      <p className="truncate text-xs font-medium text-[#767676]">
                        {product.category.name}
                        {price > 0 ? (
                          <>
                            {" "}
                            ·{" "}
                            <span className="inline text-[#ec6e55]">
                              <PriceDisplay pricePaise={price} />
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-[#767676]" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {results.productTotal > results.products.length ? (
        <Link
          href={searchHref}
          onClick={onNavigate}
          className="flex items-center justify-center gap-2 border-t border-[#efe8e4] py-3 text-xs font-bold text-[#ec6e55] transition-colors hover:bg-[#faf3ef] hover:text-[#23403d]"
        >
          See all {results.productTotal} product results
          <ChevronRight className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}
