import type { MetadataRoute } from "next";
import { getStoreCategories } from "@/lib/categories";
import {
  absoluteUrl,
  isProductionIndexableSite,
  PUBLIC_STATIC_PATHS,
} from "@/lib/seo";
import { fetchStorefrontProducts } from "@/lib/storefront-products";

export const revalidate = 3600;

async function fetchAllActiveProductSlugs(): Promise<string[]> {
  const slugs: string[] = [];
  let page = 1;
  let totalPages = 1;
  const limit = 100;

  while (page <= totalPages) {
    const { products, meta } = await fetchStorefrontProducts({
      page,
      limit,
      sort: "newest",
    });

    for (const product of products) {
      if (product.isActive && product.slug) {
        slugs.push(product.slug);
      }
    }

    totalPages = Math.max(1, meta?.totalPages ?? 1);
    page += 1;
  }

  return slugs;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!isProductionIndexableSite()) {
    return [];
  }

  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = PUBLIC_STATIC_PATHS.map((path) => ({
    url: absoluteUrl(path),
    lastModified: now,
    changeFrequency:
      path === "/" || path === "/products" ? ("daily" as const) : ("monthly" as const),
    priority: path === "/" ? 1 : path === "/products" ? 0.9 : 0.5,
  }));

  const [categories, productSlugs] = await Promise.all([
    getStoreCategories(),
    fetchAllActiveProductSlugs(),
  ]);

  const categoryEntries: MetadataRoute.Sitemap = categories.map((category) => ({
    url: absoluteUrl(`/categories/${category.slug}`),
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const productEntries: MetadataRoute.Sitemap = productSlugs.map((slug) => ({
    url: absoluteUrl(`/products/${slug}`),
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  return [...staticEntries, ...categoryEntries, ...productEntries];
}
