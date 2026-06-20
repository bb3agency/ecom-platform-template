"use client";

import Link from "next/link";
import Image from "next/image";
import { Phone, Menu, Leaf } from "lucide-react";
import { APP_NAME, BRAND_LOGO_SRC } from "@/lib/constants";
import { MainNav } from "@/components/layout/MainNav";
import { SearchInput } from "@/components/shared/SearchInput";
import { MobileNav } from "@/components/layout/MobileNav";
import { useSessionBootstrap } from "@/hooks/use-session-bootstrap";
import { useUiStore } from "@/stores/ui";
import { formatPrice } from "@/lib/format-price";
import type { CategoryWithMeta } from "@/lib/categories";

interface HeaderProps {
  categories: CategoryWithMeta[];
  /** Minimum order value in paise from the database. 0 = no minimum enforced. */
  minOrderValuePaise?: number;
}

export function Header({ categories, minOrderValuePaise = 0 }: HeaderProps) {
  useSessionBootstrap();
  const setMobileMenuOpen = useUiStore((s) => s.setMobileMenuOpen);

  return (
    <>
      <MobileNav minOrderValuePaise={minOrderValuePaise} />
      <header className="sticky top-0 z-50 w-full border-b border-[#efe8e4] bg-white shadow-sm transition-all">
      {/* Top Banner */}
      <div className="hidden bg-[#23403d] px-4 py-1.5 text-center text-xs font-medium text-white sm:block">
        {minOrderValuePaise > 0 ? (
          <>
            Minimum order value:{" "}
            <span className="font-bold text-[#ec6e55]">
              {formatPrice(minOrderValuePaise)}
            </span>
            . Shop fresh chemical-free produce today!
          </>
        ) : (
          "Farm-fresh chemical-free produce. Lab-tested. Delivered to your door."
        )}
      </div>

      {/* Main Header */}
      <div className="mx-auto flex h-16 sm:h-20 w-full max-w-[1440px] items-center justify-between gap-2 sm:gap-4 px-3 sm:px-4 lg:gap-8 lg:px-8">
        
        {/* Logo */}
        <div className="flex items-center">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-1.5 sm:gap-2 font-heading text-lg sm:text-2xl font-bold tracking-tight text-[#23403d]"
            aria-label={`${APP_NAME} home`}
          >
            <Image src={BRAND_LOGO_SRC} alt="Raghava Organics Logo" width={36} height={36} className="size-8 sm:size-9 shrink-0 object-contain" />
            <span className="truncate">{APP_NAME}</span>
          </Link>
        </div>

        {/* Central Search (Desktop) */}
        <div className="hidden flex-1 max-w-2xl overflow-visible lg:block">
          <div className="relative z-[60] w-full">
            <SearchInput />
          </div>
        </div>

        {/* Support & Actions */}
        <div className="flex items-center gap-2 sm:gap-4 lg:gap-6">
          <div className="hidden items-center gap-3 lg:flex">
            <div className="flex size-11 items-center justify-center rounded-full bg-[#eff5ee] text-[#ec6e55]">
              <Phone className="size-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-[#767676]">Call Us 24/7</span>
              <a href="tel:+919440445006" className="text-sm font-bold text-[#23403d] hover:text-[#ec6e55]">+91 94404 45006</a>
            </div>
          </div>
          
          <div className="h-8 w-px bg-[#efe8e4] hidden lg:block" aria-hidden="true" />
          
          <MainNav />

          <button 
            onClick={() => setMobileMenuOpen(true)}
            className="flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-full bg-[#eff5ee] text-[#23403d] lg:hidden" 
            aria-label="Open menu"
          >
            <Menu className="size-4 sm:size-5" />
          </button>
        </div>
      </div>

      {/* Navigation Row */}
      <div className="hidden border-t border-[#efe8e4] bg-white lg:block">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-8 px-8">
          <Link href="/products" className="flex h-14 items-center gap-2 bg-[#23403d] px-6 text-sm font-bold text-white transition-colors hover:bg-[#1a302e]">
            <Menu className="size-4" /> Browse Categories
          </Link>
          
          <nav
            className="flex items-center gap-8 text-sm font-bold text-[#23403d]"
            aria-label="Store navigation"
          >
            <Link href="/" className="transition-colors hover:text-[#ec6e55]">Home</Link>
            <Link href="/products" className="transition-colors hover:text-[#ec6e55]">Shop</Link>
            {categories.slice(0, 3).map((cat) => (
              <Link key={cat.slug} href={`/categories/${cat.slug}`} className="transition-colors hover:text-[#ec6e55]">
                {cat.name}
              </Link>
            ))}
            <Link href="/products?sort=popularity" className="flex items-center gap-1 text-[#ec6e55] transition-colors hover:text-[#23403d]">
              Special Offers <Leaf className="size-3" />
            </Link>
          </nav>
        </div>
      </div>
    </header>
    </>
  );
}
