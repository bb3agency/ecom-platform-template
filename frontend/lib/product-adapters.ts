import type { Product } from "@/types/product";
import { resolveProductImageUrl } from "@/lib/media-url";

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function mapProduct(raw: unknown): Product {
  const item = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {};

  const imagesRaw = Array.isArray(item.images) ? item.images : [];
  const images = imagesRaw.map((image) => {
    const img = image as Record<string, unknown>;
    return {
      id: toStringValue(img.id, ""),
      url: resolveProductImageUrl(toStringValue(img.url, "")),
      altText: toStringValue(
        img.altText,
        toStringValue(item.name, "Product image"),
      ),
      sortOrder: toNumber(img.sortOrder, 0),
    };
  });

  const categoryRaw =
    item.category && typeof item.category === "object"
      ? (item.category as Record<string, unknown>)
      : null;

  const variantsRaw = Array.isArray(item.variants) ? item.variants : [];
  const variants = variantsRaw.map((variant) => {
    const obj = variant as Record<string, unknown>;
    return {
      id: toStringValue(obj.id),
      name: toStringValue(obj.name),
      sku: toStringValue(obj.sku),
      price: toNumber(obj.price, 0),
      compareAtPrice:
        typeof obj.compareAtPrice === "number" ? obj.compareAtPrice : null,
      isActive: Boolean(obj.isActive ?? true),
    };
  });

  const reviewsRaw = Array.isArray(item.reviews) ? item.reviews : [];
  const reviewCount =
    reviewsRaw.length > 0
      ? reviewsRaw.length
      : toNumber(item.reviewCount, 0);
  const rating =
    reviewsRaw.length > 0
      ? reviewsRaw.reduce((sum, review) => {
          const value =
            typeof review === "object" &&
            review !== null &&
            typeof (review as Record<string, unknown>).rating === "number"
              ? ((review as Record<string, unknown>).rating as number)
              : 0;
          return sum + value;
        }, 0) / reviewsRaw.length
      : toNumber(item.rating, 0);

  const firstActiveVariant = variants.find((v) => v.isActive) ?? variants[0];

  return {
    id: toStringValue(item.id, "unknown-id"),
    name: toStringValue(item.name, "Untitled product"),
    slug: toStringValue(item.slug, toStringValue(item.id, "product")),
    description: toStringValue(item.description),
    category: {
      id: toStringValue(categoryRaw?.id, ""),
      name: toStringValue(categoryRaw?.name, "General"),
      slug: toStringValue(categoryRaw?.slug, ""),
    },
    rating,
    reviewCount,
    tags: Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    isFeatured: Boolean(item.isFeatured ?? false),
    isActive: Boolean(item.isActive ?? true),
    images,
    variants,
    inStock:
      typeof item.inStock === "boolean"
        ? item.inStock
        : Boolean(firstActiveVariant),
  };
}

export interface ProductListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function mapProductListResponseWithMeta(payload: unknown): {
  products: Product[];
  meta: ProductListMeta | null;
} {
  let meta: ProductListMeta | null = null;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const obj = payload as { meta?: unknown; items?: unknown[] };
    if (obj.meta && typeof obj.meta === "object") {
      const m = obj.meta as Record<string, unknown>;
      if (
        typeof m.page === "number" &&
        typeof m.limit === "number" &&
        typeof m.total === "number" &&
        typeof m.totalPages === "number"
      ) {
        meta = {
          page: m.page,
          limit: m.limit,
          total: m.total,
          totalPages: m.totalPages,
        };
      }
    }
  }
  return { products: mapProductListResponse(payload), meta };
}

export function mapProductListResponse(payload: unknown): Product[] {
  if (Array.isArray(payload)) {
    return payload.map(mapProduct);
  }

  if (payload && typeof payload === "object") {
    const obj = payload as { items?: unknown[] };
    if (Array.isArray(obj.items)) {
      return obj.items.map(mapProduct);
    }
  }

  return [];
}
