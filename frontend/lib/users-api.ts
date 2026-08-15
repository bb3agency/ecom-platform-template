import { apiClient } from "@/lib/api";
import type { User } from "@/types/user";

/** Safe unwrap for `{ items, meta }` or bare-array API responses. */
function unwrapItems<T>(response: unknown): T[] {
  if (Array.isArray(response)) return response as T[];
  if (
    response !== null &&
    typeof response === "object" &&
    "items" in response &&
    Array.isArray((response as { items: unknown }).items)
  ) {
    return (response as { items: T[] }).items;
  }
  return [];
}

export interface UserAddress {
  id: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export async function getCurrentUser(accessToken: string): Promise<User> {
  return apiClient<User>("/users/me", {
    method: "GET",
    accessToken,
  });
}

export async function getMyAddresses(accessToken: string): Promise<UserAddress[]> {
  const response = await apiClient<unknown>("/users/me/addresses", {
    method: "GET",
    accessToken,
  });
  return unwrapItems<UserAddress>(response);
}

export interface UserOrder {
  id: string;
  orderNumber: string;
  status: string;
  paymentMode: "PREPAID" | "COD";
  total: number;
  createdAt: string;
  invoice?: { hasPdf?: boolean } | null;
}

export async function getMyOrders(accessToken: string): Promise<UserOrder[]> {
  const response = await apiClient<unknown>("/users/me/orders", {
    method: "GET",
    accessToken,
  });
  return unwrapItems<UserOrder>(response);
}

export type CreateUserAddressInput = {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  pincode: string;
  isDefault?: boolean;
};

export async function createMyAddress(
  accessToken: string,
  input: CreateUserAddressInput,
): Promise<UserAddress> {
  return apiClient<UserAddress>("/users/me/addresses", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  });
}

export async function updateMyAddress(
  accessToken: string,
  id: string,
  input: Partial<Omit<UserAddress, "id" | "createdAt" | "updatedAt">>,
): Promise<UserAddress> {
  return apiClient<UserAddress>(`/users/me/addresses/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(input),
  });
}

export async function deleteMyAddress(
  accessToken: string,
  id: string,
): Promise<void> {
  return apiClient<void>(`/users/me/addresses/${id}`, {
    method: "DELETE",
    accessToken,
  });
}

/**
 * Profile update — NAMES ONLY. `email` and `phone` are login/recovery
 * identifiers and are rejected by the API here (pentest F-1, 2026-08-15):
 * holding an access token does not prove you own the value being set. Use
 * requestIdentifierChange → verifyIdentifierChange instead.
 */
export async function updateMyProfile(
  accessToken: string,
  input: { firstName?: string; lastName?: string },
): Promise<User> {
  return apiClient<User>("/users/me", {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(input),
  });
}

export type IdentifierType = "email" | "phone";

export interface IdentifierChangeRequestResult {
  message: string;
  type: IdentifierType;
  /** Masked target of the confirmation code, e.g. `me••@example.com`. */
  currentTargetMasked: string;
  /** Masked new target; null when removing a mobile number. */
  newTargetMasked: string | null;
  expiresInSeconds: number;
}

/**
 * Step 1 of changing a login identifier: sends a code to the identifier already
 * on the account (the ownership proof) and, when setting a new value, a second
 * code to that value. Pass `newValue: null` to remove a mobile number.
 */
export async function requestIdentifierChange(
  accessToken: string,
  input: { type: IdentifierType; newValue: string | null },
): Promise<IdentifierChangeRequestResult> {
  return apiClient<IdentifierChangeRequestResult>("/users/me/identifier/change/request", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  });
}

/**
 * Step 2: submit both codes to commit the change. Every session is revoked on
 * success, so the caller must send the user back through sign-in.
 */
export async function verifyIdentifierChange(
  accessToken: string,
  input: { type: IdentifierType; currentOtp: string; newOtp?: string },
): Promise<User> {
  return apiClient<User>("/users/me/identifier/change/verify", {
    method: "POST",
    accessToken,
    body: JSON.stringify(input),
  });
}
