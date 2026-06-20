import { apiClient } from "@/lib/api";
import { mapProductListResponse } from "@/lib/product-adapters";
import { normalizeStorefrontSearchQuery } from "@/lib/storefront-search";
import type { Product } from "@/types/product";

export type StorefrontProductSort =
  | "newest"
  | "popularity"
  | "price_asc"
  | "price_desc";

export interface StorefrontProductsMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface StorefrontProductsResult {
  products: Product[];
  meta: StorefrontProductsMeta | null;
}

export interface FetchStorefrontProductsOptions {
  page?: number;
  limit?: number;
  sort?: StorefrontProductSort;
  search?: string;
  category?: string;
  /** When false, lists all active products (including out-of-stock). Default false for storefront browse. */
  inStock?: boolean;
}

const DEFAULT_META: StorefrontProductsMeta = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
};

function extractMeta(payload: unknown): StorefrontProductsMeta | null {
  if (!payload || typeof payload !== "object") return null;
  const meta = (payload as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object") return null;
  const row = meta as Record<string, unknown>;
  if (
    typeof row.page === "number" &&
    typeof row.limit === "number" &&
    typeof row.total === "number" &&
    typeof row.totalPages === "number"
  ) {
    return {
      page: row.page,
      limit: row.limit,
      total: row.total,
      totalPages: row.totalPages,
    };
  }
  return null;
}

/**
 * Fetches active catalog products from the public API (`isActive: true` on backend).
 * Uses `inStock=false` by default so newly added admin products appear even before stock is set.
 */
export async function fetchStorefrontProducts(
  options: FetchStorefrontProductsOptions = {},
): Promise<StorefrontProductsResult> {
  const {
    page = 1,
    limit = 20,
    sort = "newest",
    search,
    category,
    inStock = false,
  } = options;

  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sort,
    inStock: String(inStock),
  });
  const normalizedSearch = search
    ? normalizeStorefrontSearchQuery(search)
    : "";
  if (normalizedSearch) params.set("search", normalizedSearch);
  if (category?.trim()) params.set("category", category.trim());

  try {
    const payload = await apiClient<unknown>(`/products?${params.toString()}`);
    return {
      products: mapProductListResponse(payload),
      meta: extractMeta(payload) ?? DEFAULT_META,
    };
  } catch {
    return { products: [], meta: DEFAULT_META };
  }
}

export async function fetchStorefrontCategoryProducts(
  categorySlug: string,
  options: Omit<FetchStorefrontProductsOptions, "category"> = {},
): Promise<StorefrontProductsResult> {
  const {
    page = 1,
    limit = 20,
    sort = "newest",
    inStock = false,
  } = options;

  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sort,
    inStock: String(inStock),
  });

  try {
    const payload = await apiClient<unknown>(
      `/products/categories/${encodeURIComponent(categorySlug)}/products?${params.toString()}`,
    );
    return {
      products: mapProductListResponse(payload),
      meta: extractMeta(payload) ?? DEFAULT_META,
    };
  } catch {
    return { products: [], meta: DEFAULT_META };
  }
}

/** Featured first, then fill with other active products. */
export function prioritizeFeaturedProducts(products: Product[], limit: number): Product[] {
  const featured = products.filter((p) => p.isFeatured);
  const rest = products.filter((p) => !p.isFeatured);
  return [...featured, ...rest].slice(0, limit);
}
