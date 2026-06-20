import type { CartLineItem } from "@/types/cart";
import { resolveProductImageUrl } from "@/lib/media-url";

export function getCartLineProductName(item: CartLineItem): string {
  const productName = item.product?.name?.trim();
  if (productName) {
    return productName;
  }
  if (item.variant.name !== "Default") {
    return item.variant.name;
  }
  return item.variant.sku;
}

export function getCartLineShortDescription(item: CartLineItem): string | null {
  const shortDescription = item.product?.metaDescription?.trim();
  return shortDescription || null;
}

export function getCartLineVariantLabel(item: CartLineItem): string | null {
  const variantName = item.variant.name.trim();
  if (variantName === "Default") {
    return null;
  }
  const productName = item.product?.name?.trim();
  if (productName && variantName === productName) {
    return null;
  }
  return variantName;
}

export function getCartLineImageUrl(item: CartLineItem): string {
  const imageUrl = item.product?.imageUrl?.trim();
  if (!imageUrl) {
    return "/images/product-placeholder.svg";
  }
  return resolveProductImageUrl(imageUrl);
}

export function getCartLineImageAlt(item: CartLineItem): string {
  return item.product?.imageAlt?.trim() || getCartLineProductName(item);
}
