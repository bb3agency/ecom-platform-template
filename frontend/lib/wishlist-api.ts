import { apiClient } from "@/lib/api";
import type { Product } from "@/types/product";

export interface WishlistItem {
  id: string;
  createdAt: string;
  product: Pick<Product, "id" | "name" | "slug" | "description" | "isFeatured">;
}

export interface WishlistListResponse {
  items: WishlistItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export async function getWishlist(
  accessToken: string,
  query?: { page?: number; limit?: number },
): Promise<WishlistListResponse> {
  const params = new URLSearchParams();
  if (query?.page) params.set("page", String(query.page));
  if (query?.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return apiClient<WishlistListResponse>(`/wishlist${qs ? `?${qs}` : ""}`, {
    method: "GET",
    accessToken,
  });
}

export async function addToWishlist(
  productId: string,
  accessToken: string,
): Promise<WishlistItem> {
  return apiClient<WishlistItem>("/wishlist/items", {
    method: "POST",
    accessToken,
    body: JSON.stringify({ productId }),
  });
}

export async function removeFromWishlist(
  productId: string,
  accessToken: string,
): Promise<{ message: string }> {
  return apiClient<{ message: string }>(`/wishlist/items/${productId}`, {
    method: "DELETE",
    accessToken,
  });
}
