import { apiClient } from "@/lib/api";
import { createIdempotencyKey } from "@/lib/idempotency";
import type { Cart, DeliveryRates } from "@/types/cart";
import {
  addCartItemInputSchema,
  updateCartItemInputSchema,
} from "@/lib/validators";

export interface AddCartItemInput {
  variantId: string;
  quantity: number;
}

export interface UpdateCartItemInput {
  quantity: number;
}

export async function getCart(accessToken?: string | null): Promise<Cart> {
  return apiClient<Cart>("/cart", {
    method: "GET",
    accessToken: accessToken ?? null,
  });
}

export async function addCartItem(
  input: AddCartItemInput,
  accessToken?: string | null,
): Promise<Cart> {
  const body = addCartItemInputSchema.parse(input);
  return apiClient<Cart>("/cart/items", {
    method: "POST",
    accessToken: accessToken ?? null,
    idempotencyKey: createIdempotencyKey(),
    body: JSON.stringify(body),
  });
}

export async function updateCartItem(
  id: string,
  input: UpdateCartItemInput,
  accessToken?: string | null,
): Promise<Cart> {
  const body = updateCartItemInputSchema.parse(input);
  return apiClient<Cart>(`/cart/items/${id}`, {
    method: "PATCH",
    accessToken: accessToken ?? null,
    body: JSON.stringify(body),
  });
}

export async function removeCartItem(
  id: string,
  accessToken?: string | null,
): Promise<Cart> {
  return apiClient<Cart>(`/cart/items/${id}`, {
    method: "DELETE",
    accessToken: accessToken ?? null,
  });
}

export async function clearCart(accessToken?: string | null): Promise<Cart> {
  return apiClient<Cart>("/cart", {
    method: "DELETE",
    accessToken: accessToken ?? null,
  });
}

export async function mergeCart(accessToken: string): Promise<Cart> {
  return apiClient<Cart>("/cart/merge", {
    method: "POST",
    accessToken,
    body: JSON.stringify({}),
  });
}

export async function checkPincodeServiceability(
  pincode: string,
): Promise<{ pincode: string; serviceable: boolean }> {
  return apiClient<{ pincode: string; serviceable: boolean }>(
    "/cart/check-pincode",
    {
      method: "POST",
      body: JSON.stringify({ pincode }),
    },
  );
}

export async function getDeliveryRates(
  pincode: string,
  accessToken?: string | null,
  paymentMode: "COD" | "PREPAID" = "PREPAID",
): Promise<DeliveryRates> {
  const params = new URLSearchParams({ pincode, paymentMode }).toString();
  return apiClient<DeliveryRates>(`/cart/delivery-rates?${params}`, {
    method: "GET",
    accessToken: accessToken ?? null,
  });
}

export async function applyCartCoupon(
  code: string,
  accessToken?: string | null,
): Promise<Cart> {
  return apiClient<Cart>("/cart/coupon", {
    method: "POST",
    accessToken: accessToken ?? null,
    idempotencyKey: createIdempotencyKey(),
    body: JSON.stringify({ code: code.trim() }),
  });
}

export async function removeCartCoupon(
  accessToken?: string | null,
): Promise<Cart> {
  return apiClient<Cart>("/cart/coupon", {
    method: "DELETE",
    accessToken: accessToken ?? null,
  });
}
