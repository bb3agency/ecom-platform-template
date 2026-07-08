import type { CartLineItem } from "@/types/cart";
import {
  getCartLineProductName,
  getCartLineShortDescription,
  getCartLineVariantLabel,
} from "@/lib/cart-line-display";

interface CartLineProductDetailsProps {
  item: CartLineItem;
  nameClassName?: string;
  descriptionClassName?: string;
  variantClassName?: string;
}

export function CartLineProductDetails({
  item,
  nameClassName = "truncate text-sm font-bold text-primary sm:text-base",
  descriptionClassName = "mt-0.5 text-xs text-muted-foreground line-clamp-2",
  variantClassName = "mt-0.5 text-xs font-medium text-muted-foreground",
}: CartLineProductDetailsProps) {
  const productName = getCartLineProductName(item);
  const shortDescription = getCartLineShortDescription(item);
  const variantLabel = getCartLineVariantLabel(item);

  return (
    <>
      <span className={nameClassName}>{productName}</span>
      {shortDescription ? <p className={descriptionClassName}>{shortDescription}</p> : null}
      {variantLabel ? <p className={variantClassName}>{variantLabel}</p> : null}
    </>
  );
}
