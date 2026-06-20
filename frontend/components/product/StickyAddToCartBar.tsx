"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ShoppingCart } from "lucide-react";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { formatPrice } from "@/lib/format-price";
import { cn } from "@/lib/utils";

interface StickyAddToCartBarProps {
  productName: string;
  productImage: string;
  imageAlt: string;
  price: number;
  compareAtPrice?: number;
  variantId: string;
  inStock: boolean;
  /** id of the element to observe — when it leaves the viewport the bar shows */
  anchorId?: string;
}

export function StickyAddToCartBar({
  productName,
  productImage,
  imageAlt,
  price,
  compareAtPrice,
  variantId,
  inStock,
  anchorId = "pdp-atc-anchor",
}: StickyAddToCartBarProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const anchor = document.getElementById(anchorId);
    if (!anchor) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // show bar when the anchor is NOT intersecting (scrolled past)
        setVisible(!entry.isIntersecting);
      },
      { threshold: 0, rootMargin: "0px 0px -80px 0px" },
    );

    observer.observe(anchor);
    return () => observer.disconnect();
  }, [anchorId]);

  if (!inStock) return null;

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 border-t border-[#e3ebe1] bg-white/95 shadow-[0_-4px_20px_-4px_rgba(35,64,61,0.12)] backdrop-blur-sm transition-transform duration-300",
        visible ? "translate-y-0" : "translate-y-full",
      )}
    >
      <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-4 py-3 sm:gap-5 sm:px-6 lg:px-8">
        {/* Product thumb */}
        <div className="relative hidden size-12 shrink-0 overflow-hidden rounded-xl border border-[#e8ede7] bg-[#fafafa] sm:block">
          <Image
            src={productImage}
            alt={imageAlt}
            fill
            className="object-contain p-1"
            sizes="48px"
          />
        </div>

        {/* Name + price */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[#23403d]">{productName}</p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-sm font-extrabold text-[#ec6e55]">
              {formatPrice(price)}
            </span>
            {compareAtPrice && compareAtPrice > price ? (
              <span className="text-xs text-[#aaa] line-through">
                {formatPrice(compareAtPrice)}
              </span>
            ) : null}
          </div>
        </div>

        {/* CTA */}
        <AddToCartButton
          variantId={variantId}
          className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#23403d] px-5 text-sm font-bold text-white transition-colors hover:bg-[#ec6e55] sm:h-11 sm:px-7"
          label="Add to cart"
          icon={<ShoppingCart className="size-4" />}
        />
      </div>
    </div>
  );
}
