"use client";

import { useEffect, useState } from "react";
import { ShoppingCart, Zap } from "lucide-react";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { PriceDisplay } from "@/components/shared/PriceDisplay";
import type { Product, ProductVariant } from "@/types/product";

interface ProductVariantSelectorProps {
  product: Product;
  defaultVariant: ProductVariant;
}

export function ProductVariantSelector({
  product,
  defaultVariant,
}: ProductVariantSelectorProps) {
  const [selectedVariant, setSelectedVariant] =
    useState<ProductVariant>(defaultVariant);

  // `?variant=<id>` deep-links (e.g. from order history) preselect that variant. Read from
  // window on mount — NOT useSearchParams — so the statically-rendered PDP needs no Suspense
  // boundary and stays fully ISR-cacheable.
  useEffect(() => {
    const requestedId = new URLSearchParams(window.location.search).get("variant");
    if (!requestedId) return;
    const requested = product.variants.find((v) => v.id === requestedId);
    if (requested) setSelectedVariant(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasDiscount =
    typeof selectedVariant?.compareAtPrice === "number" &&
    selectedVariant.compareAtPrice > selectedVariant.price;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Price */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <div className="text-2xl">
          <PriceDisplay
            pricePaise={selectedVariant?.price ?? 0}
            originalPricePaise={
              hasDiscount
                ? (selectedVariant?.compareAtPrice ?? undefined)
                : undefined
            }
          />
        </div>
        {hasDiscount && selectedVariant?.compareAtPrice && (
          <span className="rounded-full bg-[#ec6e55] px-3 py-1 text-xs font-bold uppercase tracking-wider text-white">
            Save{" "}
            {Math.round(
              (1 - selectedVariant.price / selectedVariant.compareAtPrice) *
                100,
            )}
            %
          </span>
        )}
      </div>

      {/* Variants */}
      {product.variants.length > 1 && (
        <div className="flex flex-col gap-3 pt-2">
          <p className="text-xs font-bold uppercase tracking-wider text-[#23403d]">
            Select Size
          </p>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {product.variants.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedVariant(v)}
                className={`rounded-full border-2 px-4 py-1.5 text-xs font-bold transition-all sm:px-5 sm:py-2 sm:text-sm ${
                  v.id === selectedVariant?.id
                    ? "border-[#23403d] bg-[#23403d] text-white"
                    : "border-[#efe8e4] text-[#767676] hover:border-[#23403d] hover:text-[#23403d]"
                }`}
              >
                {v.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* CTAs — id used by StickyAddToCartBar IntersectionObserver */}
      {product.inStock && selectedVariant ? (
        <div id="pdp-atc-anchor" className="flex flex-col gap-3 pt-2 sm:flex-row sm:gap-4">
          <AddToCartButton
            variantId={selectedVariant.id}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#eff5ee] px-6 text-sm font-bold text-[#23403d] shadow-sm transition-colors hover:bg-[#c5dac2] disabled:opacity-60 sm:h-14"
            label="Add to cart"
            icon={<ShoppingCart className="size-4 shrink-0" aria-hidden />}
          />
          <AddToCartButton
            variantId={selectedVariant.id}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[#23403d] px-6 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#ec6e55] disabled:opacity-60 sm:h-14"
            label="Buy now"
            icon={<Zap className="size-4 shrink-0" aria-hidden />}
            redirectTo="/checkout"
          />
        </div>
      ) : (
        <p className="rounded-full bg-[#faf3ef] py-4 text-center text-sm font-bold text-[#767676]">
          Currently out of stock
        </p>
      )}
    </div>
  );
}
