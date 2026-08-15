import { apiClient } from "@/lib/api";
import { resolveApiBaseUrl } from "@/lib/api-base";
import { createIdempotencyKey } from "@/lib/idempotency";

export interface GalleryImage {
  id: string;
  imageUrl: string;
  caption: string | null;
  altText: string;
  sortOrder: number;
  isActive: boolean;
  /** Merchant-entered date the photo was taken (ISO); null when never set. */
  capturedAt: string | null;
  /**
   * Date the storefront timeline groups by — `capturedAt` when set, otherwise the
   * upload date. Always present and already applied to the server's ordering, so
   * clients must not re-derive the fallback.
   */
  timelineDate: string;
  /**
   * Intrinsic pixel size, captured from the image header at upload. Drives the
   * timeline's aspect-preserving justified rows; null on images uploaded before
   * this existed, where the layout falls back to 4:3.
   */
  width: number | null;
  height: number | null;
}

export interface PublicGalleryResponse {
  enabled: boolean;
  items: GalleryImage[];
}

/** Public storefront gallery (GET /gallery). Returns { enabled:false, items:[] } when the merchant has it off. */
export async function fetchPublicGallery(): Promise<PublicGalleryResponse> {
  return apiClient<PublicGalleryResponse>("/gallery", { method: "GET" });
}

/** Admin — all gallery images (active + hidden), ordered. */
export async function fetchAdminGallery(accessToken: string): Promise<GalleryImage[]> {
  const res = await apiClient<{ items: GalleryImage[] }>("/admin/gallery", {
    method: "GET",
    accessToken,
  });
  return res.items;
}

/** Admin — upload a new image (multipart) with optional caption + alt text. */
export async function uploadGalleryImage(
  accessToken: string,
  file: File,
  options: { caption?: string; altText?: string; capturedAt?: string } = {},
): Promise<GalleryImage> {
  const base = resolveApiBaseUrl();
  if (!base) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.");
  }

  const form = new FormData();
  form.append("file", file);
  if (options.caption !== undefined) form.append("caption", options.caption);
  if (options.altText !== undefined) form.append("altText", options.altText);
  if (options.capturedAt) form.append("capturedAt", options.capturedAt);

  const response = await fetch(`${base}/admin/gallery`, {
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
      ? (body as { data: GalleryImage }).data
      : (body as GalleryImage);
  return payload;
}

export async function updateGalleryImage(
  accessToken: string,
  id: string,
  patch: {
    caption?: string | null;
    altText?: string;
    isActive?: boolean;
    sortOrder?: number;
    /** ISO date the photo was taken; null clears it (timeline falls back to upload date). */
    capturedAt?: string | null;
  },
): Promise<GalleryImage> {
  return apiClient<GalleryImage>(`/admin/gallery/${id}`, {
    method: "PATCH",
    accessToken,
    body: JSON.stringify(patch),
  });
}

export async function deleteGalleryImage(
  accessToken: string,
  id: string,
): Promise<{ message: string }> {
  return apiClient<{ message: string }>(`/admin/gallery/${id}`, {
    method: "DELETE",
    accessToken,
  });
}

/** Persist a new display order — `orderedIds` is the full list in the desired order. */
export async function reorderGallery(
  accessToken: string,
  orderedIds: string[],
): Promise<GalleryImage[]> {
  const res = await apiClient<{ items: GalleryImage[] }>("/admin/gallery/reorder", {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ orderedIds }),
  });
  return res.items;
}

/** Read the storefront gallery on/off toggle (StoreSettings.galleryEnabled, via the COD settings endpoint). */
export async function fetchGalleryEnabled(accessToken: string): Promise<boolean> {
  const res = await apiClient<{ galleryEnabled: boolean }>("/admin/settings/cod", {
    method: "GET",
    accessToken,
  });
  return res.galleryEnabled;
}

/** Toggle the storefront gallery on/off. */
export async function setGalleryEnabled(
  accessToken: string,
  enabled: boolean,
): Promise<boolean> {
  const res = await apiClient<{ galleryEnabled: boolean }>("/admin/settings/cod", {
    method: "PATCH",
    accessToken,
    body: JSON.stringify({ galleryEnabled: enabled }),
  });
  return res.galleryEnabled;
}
