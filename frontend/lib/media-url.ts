const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

/** Maximum images allowed per product — must match backend PRODUCT_MAX_IMAGES_PER_PRODUCT. */
export const MAX_PRODUCT_IMAGES = 8;

export const PRODUCT_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

export function getProductImageMaxBytes(): number {
  return MAX_PRODUCT_IMAGE_BYTES;
}

/**
 * Resolves catalog image URLs: absolute https, hosted /api/v1/media paths, or CDN prefix.
 */
export function resolveProductImageUrl(url: string | undefined | null): string {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return "/next.svg";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  const cdnBase = (process.env.NEXT_PUBLIC_IMAGE_CDN_URL ?? "").trim().replace(/\/$/, "");
  if (trimmed.startsWith("/")) {
    if (cdnBase) return `${cdnBase}${trimmed}`;
    if (typeof window === "undefined") {
      // SSR: build an absolute URL only when NEXT_PUBLIC_STOREFRONT_URL is
      // explicitly set. Never fall back to localhost in production — a missing
      // env var would embed localhost URLs in SSR-rendered HTML.
      const site = process.env.NEXT_PUBLIC_STOREFRONT_URL?.trim().replace(/\/$/, "");
      if (site) return `${site}${trimmed}`;
    }
    return trimmed;
  }
  return trimmed;
}

export function assertClientProductImageFile(file: File): string | null {
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    return `Image must be ${MAX_PRODUCT_IMAGE_BYTES / (1024 * 1024)} MB or smaller.`;
  }
  const allowed = PRODUCT_IMAGE_ACCEPT.split(",").map((v) => v.trim());
  if (!allowed.includes(file.type)) {
    return "Use JPEG, PNG, WebP, or GIF.";
  }
  return null;
}
