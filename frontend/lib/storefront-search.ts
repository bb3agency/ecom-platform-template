import { apiClient } from "@/lib/api";
import { mapProductListResponse } from "@/lib/product-adapters";
import { resolveProductImageUrl } from "@/lib/media-url";
import type { Product, ProductCategory } from "@/types/product";

export const STOREFRONT_SEARCH_DEBOUNCE_MS = 300;
export const STOREFRONT_SEARCH_MIN_CHARS = 2;
export const STOREFRONT_SEARCH_PREVIEW_LIMIT = 6;

export interface StorefrontSearchResults {
  products: Product[];
  categories: ProductCategory[];
  productTotal: number;
}

export function emptyStorefrontSearchResults(): StorefrontSearchResults {
  return {
    products: [],
    categories: [],
    productTotal: 0,
  };
}

/** Trim and collapse whitespace for stable search URLs and API calls. */
export function normalizeStorefrontSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function extractProductTotal(payload: unknown, fallback: number): number {
  if (!payload || typeof payload !== "object") return fallback;
  const meta = (payload as { meta?: { total?: unknown } }).meta;
  return typeof meta?.total === "number" ? meta.total : fallback;
}

export async function searchStorefrontCatalog(
  query: string,
  options: {
    limit?: number;
    signal?: AbortSignal;
  } = {},
): Promise<StorefrontSearchResults> {
  const trimmed = normalizeStorefrontSearchQuery(query);
  if (trimmed.length < STOREFRONT_SEARCH_MIN_CHARS) {
    return emptyStorefrontSearchResults();
  }

  const limit = options.limit ?? STOREFRONT_SEARCH_PREVIEW_LIMIT;
  const encoded = encodeURIComponent(trimmed);

  try {
    const [productsResult, categoriesResult] = await Promise.allSettled([
      apiClient<unknown>(
        `/products?search=${encoded}&limit=${limit}&page=1&sort=newest&inStock=false`,
        { signal: options.signal },
      ),
      apiClient<ProductCategory[]>(
        `/products/categories?search=${encoded}`,
        { signal: options.signal },
      ),
    ]);

    const productsPayload =
      productsResult.status === "fulfilled" ? productsResult.value : null;
    const products = productsPayload
      ? mapProductListResponse(productsPayload)
      : [];
    const categories =
      categoriesResult.status === "fulfilled" &&
      Array.isArray(categoriesResult.value)
        ? categoriesResult.value.slice(0, limit)
        : [];

    return {
      products,
      categories,
      productTotal: productsPayload
        ? extractProductTotal(productsPayload, products.length)
        : 0,
    };
  } catch (error) {
    if (options.signal?.aborted) {
      return emptyStorefrontSearchResults();
    }
    throw error;
  }
}

export function getStorefrontProductPrice(product: Product): number {
  const activeVariant =
    product.variants.find((variant) => variant.isActive) ?? product.variants[0];
  return activeVariant?.price ?? 0;
}

export function getStorefrontProductImage(product: Product): string | null {
  const url = product.images?.[0]?.url;
  if (!url) return null;
  const resolved = resolveProductImageUrl(url);
  return resolved === "/next.svg" ? null : resolved;
}

export function getStorefrontCategoryImage(category: ProductCategory): string | null {
  const url = category.imageUrl?.trim();
  if (!url) return null;
  const resolved = resolveProductImageUrl(url);
  return resolved === "/next.svg" ? null : resolved;
}

export function buildStorefrontSearchPath(query: string): string {
  const normalized = normalizeStorefrontSearchQuery(query);
  if (!normalized) return "/search";
  return `/search?q=${encodeURIComponent(normalized)}`;
}

export async function fetchStorefrontCategories(
  search?: string,
): Promise<ProductCategory[]> {
  const params = new URLSearchParams();
  const normalized = search ? normalizeStorefrontSearchQuery(search) : "";
  if (normalized) {
    params.set("search", normalized);
  }

  try {
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    const categories = await apiClient<ProductCategory[]>(
      `/products/categories${suffix}`,
    );
    return Array.isArray(categories) ? categories : [];
  } catch {
    return [];
  }
}

export function hasStorefrontSearchResults(
  results: StorefrontSearchResults | null,
): boolean {
  if (!results) return false;
  return results.products.length > 0 || results.categories.length > 0;
}
