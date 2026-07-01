"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Heart, ShoppingCart, Sparkles } from "lucide-react";
import type { Product } from "@/types/product";
import { AddToCartButton } from "@/components/cart/AddToCartButton";
import { useAuthStore } from "@/stores/auth";
import { useWishlistStore } from "@/stores/wishlist";
import { addToWishlist, removeFromWishlist } from "@/lib/wishlist-api";
import { cn } from "@/lib/utils";
import { useStoreConfig } from "@/components/providers/StoreConfigProvider";
import { formatPrice } from "@/lib/format-price";
import { Rating } from "@/components/shared/Rating";

const PLACEHOLDER_IMAGE = "/images/product-placeholder.svg";

interface ProductCardProps {
  product: Product;
  priority?: boolean;
  className?: string;
}

export function ProductCard({
  product,
  priority = false,
  className,
}: ProductCardProps) {
  const image = product.images[0];
  const accessToken = useAuthStore((s) => s.accessToken);
  const { wishlistEnabled, reviewsEnabled } = useStoreConfig();
  const items = useWishlistStore((s) => s.items);
  const toggleItem = useWishlistStore((s) => s.toggleItem);
  const [loading, setLoading] = useState(false);

  const inWishlist = items.has(product.id);

  const handleWishlistToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    const next = !inWishlist;
    // Optimistic local toggle — persists in localStorage for guests too, and
    // merges into the account on login (mirrors the guest cart).
    toggleItem(product.id, next);
    if (!accessToken) {
      // Guest: saved locally only; nothing to sync until they sign in.
      return;
    }
    setLoading(true);
    try {
      if (next) {
        await addToWishlist(product.id, accessToken);
      } else {
        await removeFromWishlist(product.id, accessToken);
      }
    } catch {
      toggleItem(product.id, !next);
    } finally {
      setLoading(false);
    }
  };

  const activeVariant =
    product.variants.find((v) => v.isActive) ?? product.variants[0];
  const hasDiscount =
    typeof activeVariant?.compareAtPrice === "number" &&
    activeVariant.compareAtPrice > activeVariant.price;
  const discountPct =
    hasDiscount && activeVariant?.compareAtPrice
      ? Math.round((1 - activeVariant.price / activeVariant.compareAtPrice) * 100)
      : 0;

  const imageSrc = image?.url && image.url !== "/next.svg" ? image.url : PLACEHOLDER_IMAGE;
  const shortDescription = product.description.trim().slice(0, 80);

  // Show up to 4 variant name chips (e.g. "500g", "1kg")
  const variantLabels = product.variants
    .filter((v) => v.isActive && v.name)
    .slice(0, 4)
    .map((v) => v.name);
  const showVariants = variantLabels.length > 1;

  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.04] transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:ring-black/[0.08]",
        className,
      )}
    >
      {/* Image */}
      <div className="relative overflow-hidden">
        <Link
          href={`/products/${product.slug}`}
          className="relative block aspect-[4/3] overflow-hidden bg-[#f5f0eb]"
          aria-label={product.name}
        >
          <Image
            src={imageSrc}
            alt={image?.altText ?? product.name}
            fill
            priority={priority}
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-110"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
          {/* Gradient overlay for bottom readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden />
        </Link>

        {/* Badges top-left */}
        <div className="absolute left-2.5 top-2.5 flex flex-wrap gap-1 z-10">
          {product.isFeatured ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-[#ec6e55] px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wide text-white shadow-sm">
              <Sparkles className="size-2.5" aria-hidden />
              Featured
            </span>
          ) : null}
          {hasDiscount && discountPct > 0 ? (
            <span className="rounded-full bg-[#23403d] px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wide text-white shadow-sm">
              -{discountPct}%
            </span>
          ) : null}
          {!product.inStock ? (
            <span className="rounded-full bg-black/60 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-wide text-white backdrop-blur-sm">
              Sold out
            </span>
          ) : null}
        </div>

        {/* Wishlist button top-right */}
        {wishlistEnabled ? (
          <button
            type="button"
            className={cn(
              "absolute right-2.5 top-2.5 z-10 flex size-8 items-center justify-center rounded-full bg-white/90 text-[#23403d] shadow-md backdrop-blur-sm transition-all hover:bg-[#ec6e55] hover:text-white hover:scale-110",
              inWishlist && "bg-[#ec6e55] text-white",
              loading && "opacity-60",
            )}
            aria-label={inWishlist ? "Remove from wishlist" : "Add to wishlist"}
            onClick={handleWishlistToggle}
            disabled={loading}
          >
            <Heart className={cn("size-3.5", inWishlist && "fill-current")} />
          </button>
        ) : null}

        {/* In-stock accent bar */}
        <div className={cn("absolute bottom-0 left-0 right-0 h-0.5", product.inStock ? "bg-[#ec6e55]" : "bg-[#d1d5db]")} aria-hidden />
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-3.5">
        {product.category.name ? (
          <Link
            href={`/categories/${product.category.slug}`}
            className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#ec6e55]/80 transition-colors hover:text-[#ec6e55]"
          >
            {product.category.name}
          </Link>
        ) : null}

        <Link href={`/products/${product.slug}`} className="mb-1.5">
          <h3 className="line-clamp-2 text-sm font-bold leading-snug text-[#1a2e2c] transition-colors group-hover:text-[#ec6e55]">
            {product.name}
          </h3>
        </Link>

        {reviewsEnabled && product.reviewCount > 0 ? (
          <div className="mb-1.5">
            <Rating rating={product.rating} reviewCount={product.reviewCount} />
          </div>
        ) : null}

        {shortDescription ? (
          <p className="mb-2.5 line-clamp-2 text-[11px] leading-relaxed text-[#888]">
            {shortDescription}
            {product.description.length > 80 ? "…" : ""}
          </p>
        ) : (
          <div className="mb-2.5 min-h-[1.25rem]" />
        )}

        {/* Variant chips */}
        {showVariants ? (
          <div className="mb-2.5 flex flex-wrap gap-1">
            {variantLabels.map((label) => (
              <span
                key={label}
                className="rounded-full border border-[#e8ede7] bg-[#faf8f5] px-2 py-0.5 text-[10px] font-semibold text-[#666]"
              >
                {label}
              </span>
            ))}
          </div>
        ) : null}

        {/* Bottom row: price + cart */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <div className="flex items-baseline gap-1.5">
            {hasDiscount && activeVariant?.compareAtPrice ? (
              <span className="text-[11px] text-[#bbb] line-through">
                {formatPrice(activeVariant.compareAtPrice)}
              </span>
            ) : null}
            <span className="text-base font-extrabold text-[#23403d]">
              {formatPrice(activeVariant?.price ?? 0)}
            </span>
          </div>

          {product.inStock && activeVariant ? (
            <AddToCartButton
              variantId={activeVariant.id}
              className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#23403d] px-3 text-[11px] font-bold text-white shadow-sm transition-all hover:bg-[#ec6e55] hover:shadow-md"
              label="Add"
              icon={<ShoppingCart className="size-3.5" />}
            />
          ) : (
            <Link
              href={`/products/${product.slug}`}
              className="flex h-9 shrink-0 items-center justify-center rounded-full border border-[#e8ede7] bg-[#faf8f5] px-3 text-[11px] font-bold text-[#999] transition-colors hover:border-[#23403d] hover:text-[#23403d]"
              aria-label={`View ${product.name}`}
            >
              View
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
