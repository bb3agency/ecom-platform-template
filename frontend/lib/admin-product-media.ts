import { resolveApiBaseUrl } from "@/lib/api-base";
import type { AdminProductImage } from "@/lib/admin-api";
import { createIdempotencyKey } from "@/lib/idempotency";

function parseUploadResponse(body: unknown): AdminProductImage | AdminProductImage[] {
  const payload =
    typeof body === "object" &&
    body !== null &&
    "success" in body &&
    (body as { success: boolean }).success &&
    "data" in body
      ? (body as { data: unknown }).data
      : body;

  if (
    typeof payload === "object" &&
    payload !== null &&
    "items" in payload &&
    Array.isArray((payload as { items: unknown }).items)
  ) {
    return (payload as { items: AdminProductImage[] }).items;
  }

  return payload as AdminProductImage;
}

export async function uploadAdminProductImages(
  accessToken: string,
  productId: string,
  files: File[],
  options: { altText: string; sortOrder: number },
): Promise<AdminProductImage[]> {
  const base = resolveApiBaseUrl();
  if (!base) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.");
  }
  if (files.length === 0) {
    throw new Error("Select at least one image file.");
  }

  const form = new FormData();
  for (const file of files) {
    form.append("file", file);
  }
  form.append("altText", options.altText);
  form.append("sortOrder", String(options.sortOrder));

  const response = await fetch(`${base}/admin/products/${productId}/images/upload`, {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "idempotency-key": createIdempotencyKey(),
    },
    body: form,
  });

  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: { message?: string } }).error?.message === "string"
        ? (body as { error: { message: string } }).error.message
        : "Image upload failed";
    throw new Error(message);
  }

  const parsed = parseUploadResponse(body);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Upload the single optional category image (replaces any existing one). Returns the updated category's imageUrl. */
export async function uploadAdminCategoryImage(
  accessToken: string,
  categoryId: string,
  file: File,
): Promise<string> {
  const base = resolveApiBaseUrl();
  if (!base) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.");
  }

  const form = new FormData();
  form.append("file", file);

  const response = await fetch(`${base}/admin/categories/${categoryId}/image/upload`, {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "idempotency-key": createIdempotencyKey(),
    },
    body: form,
  });

  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: { message?: string } }).error?.message === "string"
        ? (body as { error: { message: string } }).error.message
        : "Image upload failed";
    throw new Error(message);
  }

  const payload =
    typeof body === "object" && body !== null && "data" in body
      ? (body as { data: unknown }).data
      : body;
  const imageUrl =
    typeof payload === "object" && payload !== null && "imageUrl" in payload
      ? (payload as { imageUrl: unknown }).imageUrl
      : null;
  return typeof imageUrl === "string" ? imageUrl : "";
}

export async function uploadAdminProductImage(
  accessToken: string,
  productId: string,
  file: File,
  options: { altText: string; sortOrder: number },
): Promise<AdminProductImage> {
  const base = resolveApiBaseUrl();
  if (!base) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.");
  }

  const form = new FormData();
  form.append("file", file);
  form.append("altText", options.altText);
  form.append("sortOrder", String(options.sortOrder));

  const response = await fetch(`${base}/admin/products/${productId}/images/upload`, {
    method: "POST",
    credentials: "include",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "idempotency-key": createIdempotencyKey(),
    },
    body: form,
  });

  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: { message?: string } }).error?.message === "string"
        ? (body as { error: { message: string } }).error.message
        : "Image upload failed";
    throw new Error(message);
  }

  const parsed = parseUploadResponse(body);
  return Array.isArray(parsed) ? parsed[0]! : parsed;
}
