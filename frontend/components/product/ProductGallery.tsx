"use client";

import { useState } from "react";
import Image from "next/image";
import { ZoomIn } from "lucide-react";
import { resolveProductImageUrl } from "@/lib/media-url";
import { cn } from "@/lib/utils";

interface ProductGalleryProps {
  images: Array<{ url: string; altText: string }>;
  productName: string;
}

export function ProductGallery({ images, productName }: ProductGalleryProps) {
  const [active, setActive] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });

  const current = images[active] ?? images[0];
  const currentSrc = resolveProductImageUrl(current?.url);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!zoomed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setMousePos({ x, y });
  };

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      {/* Main image */}
      <div
        className={cn(
          "group relative aspect-square overflow-hidden rounded-2xl bg-[#faf8f5] ring-1 ring-black/[0.06] cursor-zoom-in",
          zoomed && "cursor-zoom-out",
        )}
        onClick={() => setZoomed((z) => !z)}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setZoomed(false)}
        role="img"
        aria-label={current?.altText ?? productName}
      >
        <Image
          src={currentSrc}
          alt={current?.altText ?? productName}
          fill
          priority
          className={cn(
            "object-contain p-6 transition-all duration-500 ease-out select-none",
            zoomed
              ? "scale-150"
              : "scale-100 group-hover:scale-105",
          )}
          style={
            zoomed
              ? { transformOrigin: `${mousePos.x}% ${mousePos.y}%` }
              : { transformOrigin: "center center" }
          }
          sizes="(max-width: 768px) 100vw, 55vw"
          draggable={false}
        />

        {/* Zoom hint */}
        {!zoomed && (
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-bold text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
            <ZoomIn className="size-3" aria-hidden />
            Zoom
          </div>
        )}
      </div>

      {/* Thumbnail strip */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {images.slice(0, 6).map((img, idx) => (
            <button
              key={img.url}
              type="button"
              onClick={() => { setActive(idx); setZoomed(false); }}
              className={cn(
                "relative size-16 shrink-0 overflow-hidden rounded-xl bg-[#faf8f5] ring-2 transition-all duration-200 sm:size-[72px]",
                idx === active
                  ? "ring-[#ec6e55] shadow-md"
                  : "ring-transparent opacity-60 hover:opacity-100 hover:ring-[#c5dac2]",
              )}
              aria-label={`View image ${idx + 1}`}
              aria-pressed={idx === active}
            >
              <Image
                src={resolveProductImageUrl(img.url)}
                alt={img.altText}
                fill
                className="object-contain p-2"
                sizes="72px"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
