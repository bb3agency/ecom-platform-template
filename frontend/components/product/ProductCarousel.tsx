"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Product } from "@/types/product";
import { ProductCard } from "./ProductCard";

interface ProductCarouselProps {
  products: Product[];
}

export function ProductCarousel({ products }: ProductCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = el.firstElementChild
      ? (el.firstElementChild as HTMLElement).offsetWidth + 16
      : 240;
    el.scrollBy({ left: dir === "right" ? cardWidth * 2 : -cardWidth * 2, behavior: "smooth" });
  };

  return (
    <div className="relative">
      {/* Scroll buttons — visible on md+ */}
      <button
        type="button"
        onClick={() => scroll("left")}
        className="absolute -left-4 top-1/2 z-10 hidden -translate-y-1/2 size-9 items-center justify-center rounded-full border border-[#e8ede7] bg-white shadow-sm transition-colors hover:border-[#ec6e55] hover:text-[#ec6e55] md:flex"
        aria-label="Scroll left"
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => scroll("right")}
        className="absolute -right-4 top-1/2 z-10 hidden -translate-y-1/2 size-9 items-center justify-center rounded-full border border-[#e8ede7] bg-white shadow-sm transition-colors hover:border-[#ec6e55] hover:text-[#ec6e55] md:flex"
        aria-label="Scroll right"
      >
        <ChevronRight className="size-4" />
      </button>

      {/* Scrollable track */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {products.map((product, i) => (
          <div
            key={product.id}
            className="w-[200px] shrink-0 sm:w-[220px] lg:w-[240px]"
            style={{ scrollSnapAlign: "start" }}
          >
            <ProductCard product={product} priority={i < 4} />
          </div>
        ))}
      </div>
    </div>
  );
}
