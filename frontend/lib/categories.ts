import { apiClient } from "./api";
import { resolveProductImageUrl } from "./media-url";
import type { ProductCategory } from "@/types/product";

export interface CategoryWithMeta extends ProductCategory {
  image: string;
  color: string;
}

// No stock-photo fallbacks: when the merchant hasn't uploaded a category image
// (Admin → Categories → Upload image), surfaces show the same neutral
// placeholder used by product cards — never a random third-party photo.
const CATEGORY_PLACEHOLDER_IMAGE = "/images/product-placeholder.svg";

const CATEGORY_COLOR_FALLBACKS: Record<string, string> = {
  "fresh-vegetables": "bg-[#e8f5e9]",
  "fruits": "bg-[#ffebee]",
  "spices-condiments": "bg-[#fdf2e9]",
  "flash-sale": "bg-[#fff3e0]",
};

const DEFAULT_COLOR = "bg-[#f5f5f5]";

export async function getStoreCategories(
  search?: string,
): Promise<CategoryWithMeta[]> {
  try {
    const params = new URLSearchParams();
    if (search?.trim()) {
      params.set("search", search.trim());
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    const categories = await apiClient<ProductCategory[]>(
      `/products/categories${suffix}`,
    );
    
    return categories.map((cat) => {
      const apiImage = cat.imageUrl?.trim();
      return {
        ...cat,
        image: apiImage ? resolveProductImageUrl(apiImage) : CATEGORY_PLACEHOLDER_IMAGE,
        color: CATEGORY_COLOR_FALLBACKS[cat.slug] ?? DEFAULT_COLOR,
      };
    });
  } catch (error) {
    console.error("Failed to fetch categories:", error);
    return [];
  }
}
