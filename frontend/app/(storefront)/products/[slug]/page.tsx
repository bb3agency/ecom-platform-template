import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Leaf, ShieldCheck, Truck, RotateCcw, ChevronRight } from "lucide-react";
import { apiClient } from "@/lib/api";
import { mapProduct } from "@/lib/product-adapters";
import { ProductGallery } from "@/components/product/ProductGallery";
import { Rating } from "@/components/shared/Rating";
import { ProductVariantSelector } from "@/components/product/ProductVariantSelector";
import { ProductReviewsSection } from "@/components/product/ProductReviewsSection";
import { ProductViewTracker } from "@/components/shared/ProductViewTracker";
import { ProductShareMenu } from "@/components/product/ProductShareMenu";
import { StickyAddToCartBar } from "@/components/product/StickyAddToCartBar";
import { ProductDetailTabs } from "@/components/product/ProductDetailTabs";
import { RelatedProductsSection } from "@/components/product/RelatedProductsSection";
import { ViewersAlsoLikedSection } from "@/components/product/ViewersAlsoLikedSection";
import { ProductCardSkeleton } from "@/components/product/ProductCardSkeleton";
import { getPublicStoreConfig } from "@/lib/storefront-settings";
import { STOREFRONT_URL } from "@/lib/constants";
import type { Product } from "@/types/product";

interface ProductDetailPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ProductDetailPageProps) {
  const { slug } = await params;
  try {
    const payload = await apiClient<unknown>(`/products/${slug}`);
    const product = mapProduct(payload);
    const image = product?.images[0];
    return {
      title: product?.name ?? "Product",
      description: product?.description ?? "",
      openGraph: image
        ? { images: [{ url: image.url, alt: image.altText }] }
        : undefined,
    };
  } catch {
    return { title: "Product not found" };
  }
}

function RelatedSkeleton() {
  return (
    <div className="mt-6 rounded-[20px] bg-white px-5 py-7 shadow-sm sm:mt-8 sm:px-8 sm:py-9">
      <div className="mb-6 h-7 w-48 animate-pulse rounded-lg bg-[#f0f0f0]" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="w-[200px] shrink-0">
            <ProductCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const { slug } = await params;
  let product: Product | null = null;

  try {
    const payload = await apiClient<unknown>(`/products/${slug}`);
    product = mapProduct(payload);
  } catch {
    notFound();
  }

  if (!product) notFound();

  const activeVariant =
    product.variants.find((v) => v.isActive) ?? product.variants[0];
  const storeConfig = await getPublicStoreConfig();
  const productUrl = `${STOREFRONT_URL}/products/${product.slug}`;

  const firstImage = product.images[0];
  const imageSrc = firstImage?.url ?? "/images/product-placeholder.svg";

  const hasDiscount =
    typeof activeVariant?.compareAtPrice === "number" &&
    activeVariant.compareAtPrice > activeVariant.price;

  return (
    <div className="min-h-screen bg-[#eff5ee] pb-24">
      <ProductViewTracker productId={product.id} productName={product.name} />

      {/* Sticky bar — appears when CTA scrolls out of view */}
      {product.inStock && activeVariant ? (
        <StickyAddToCartBar
          productName={product.name}
          productImage={imageSrc}
          imageAlt={firstImage?.altText ?? product.name}
          price={activeVariant.price}
          compareAtPrice={hasDiscount ? (activeVariant.compareAtPrice ?? undefined) : undefined}
          variantId={activeVariant.id}
          inStock={product.inStock}
        />
      ) : null}

      <div className="mx-auto max-w-[1440px] px-4 py-4 sm:py-8 lg:px-8">
        {/* Breadcrumb */}
        <nav
          className="mb-4 flex flex-wrap items-center gap-1.5 text-xs font-bold text-[#767676] sm:mb-8 sm:gap-2 sm:text-sm"
          aria-label="Breadcrumb"
        >
          <Link href="/" className="transition-colors hover:text-[#ec6e55]">
            Home
          </Link>
          <ChevronRight className="size-3" />
          <Link href="/products" className="transition-colors hover:text-[#ec6e55]">
            Shop
          </Link>
          <ChevronRight className="size-3" />
          <Link
            href={`/categories/${product.category.slug}`}
            className="transition-colors hover:text-[#ec6e55]"
          >
            {product.category.name}
          </Link>
          <ChevronRight className="size-3" />
          <span className="truncate text-[#ec6e55]">{product.name}</span>
        </nav>

        {/* ── Main product grid ─────────────────────────────────────────────── */}
        <div className="grid gap-6 rounded-[20px] bg-white p-4 shadow-sm sm:gap-10 sm:p-6 lg:grid-cols-[52%_48%] lg:p-12">
          {/* Gallery */}
          <div className="rounded-[20px] bg-[#faf3ef] p-4 lg:p-8">
            <ProductGallery images={product.images} productName={product.name} />
          </div>

          {/* Info panel */}
          <section className="flex flex-col gap-5">
            {/* Category */}
            <Link
              href={`/categories/${product.category.slug}`}
              className="w-fit text-[11px] font-extrabold uppercase tracking-widest text-[#ec6e55] hover:underline"
            >
              {product.category.name}
            </Link>

            {/* Title */}
            <h1 className="font-heading text-2xl font-bold leading-tight text-[#23403d] sm:text-3xl md:text-4xl">
              {product.name}
            </h1>

            {/* Rating */}
            {storeConfig.reviewsEnabled && (
              <div className="flex flex-wrap items-center gap-2">
                <Rating rating={product.rating} reviewCount={product.reviewCount} />
                <span className="text-sm font-semibold text-[#999]">
                  ({product.reviewCount} {product.reviewCount === 1 ? "review" : "reviews"})
                </span>
              </div>
            )}

            <hr className="border-[#f0f0f0]" />

            {/* Short description — above the price */}
            {product.description ? (
              <p className="line-clamp-3 text-sm leading-relaxed text-[#666]">
                {product.description}
              </p>
            ) : null}

            {/* Stock indicator + share */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                {product.inStock ? (
                  <>
                    <span className="inline-block size-2 rounded-full bg-[#00aa63]" aria-hidden />
                    <span className="text-[#00aa63]">In stock, ready to ship</span>
                  </>
                ) : (
                  <>
                    <span className="inline-block size-2 rounded-full bg-[#ec6e55]" aria-hidden />
                    <span className="text-[#ec6e55]">Out of stock</span>
                  </>
                )}
              </div>
              <ProductShareMenu productName={product.name} productUrl={productUrl} />
            </div>

            {/* Price + variant selector + CTAs */}
            <ProductVariantSelector product={product} defaultVariant={activeVariant} />

            {/* Trust signals */}
            <div className="mt-2 grid grid-cols-2 gap-3 rounded-[20px] bg-[#faf3ef] p-4 sm:gap-4 sm:p-5">
              {[
                { icon: Leaf, text: "100% Chemical Free" },
                { icon: Truck, text: "Free Delivery" },
                { icon: RotateCcw, text: "Easy Returns" },
                { icon: ShieldCheck, text: "Secure Pay" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 sm:gap-3">
                  <Icon className="size-4 shrink-0 text-[#ec6e55] sm:size-5" aria-hidden />
                  <span className="text-xs font-bold text-[#23403d] sm:text-sm">{text}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* ── Description + Additional Information tabs ─────────────────────── */}
        <ProductDetailTabs
          description={product.description}
          tags={product.tags}
          categoryName={product.category.name}
          categorySlug={product.category.slug}
        />

        {/* ── You may also like ─────────────────────────────────────────────── */}
        <Suspense fallback={<RelatedSkeleton />}>
          <RelatedProductsSection
            categorySlug={product.category.slug}
            currentProductId={product.id}
          />
        </Suspense>

        {/* ── Viewers also liked ────────────────────────────────────────────── */}
        <Suspense fallback={<RelatedSkeleton />}>
          <ViewersAlsoLikedSection currentProductId={product.id} />
        </Suspense>

        {/* ── Reviews ──────────────────────────────────────────────────────── */}
        {storeConfig.reviewsEnabled ? (
          <div className="mt-6 sm:mt-8">
            <ProductReviewsSection productSlug={product.slug} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
