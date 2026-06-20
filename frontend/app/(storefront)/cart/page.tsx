import Link from "next/link";
import { ChevronRight, ShoppingCart } from "lucide-react";
import { CartWorkspace } from "@/components/cart/CartWorkspace";

export const metadata = {
  title: "Your Cart",
};

export default function CartPage() {
  return (
    <div className="flex flex-col bg-[#f4f7f2] min-h-screen pb-16">
      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#23403d] via-[#2d5450] to-[#1a2f2e] py-10 md:py-16">
        <div className="absolute -top-16 right-16 size-56 rounded-full bg-[#ec6e55] opacity-10 blur-3xl" aria-hidden />
        <div className="absolute -bottom-12 -left-12 size-48 rounded-full bg-[#c5dac2] opacity-15 blur-3xl" aria-hidden />

        <div className="relative mx-auto flex w-full max-w-[1440px] flex-col items-center justify-center px-4 text-center lg:px-8">
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm">
            <ShoppingCart className="size-5 text-white" aria-hidden />
          </div>
          <h1 className="mb-3 font-heading text-3xl font-bold text-white sm:text-4xl md:text-5xl">
            Shopping Cart
          </h1>
          <nav className="flex items-center gap-1.5 text-xs font-semibold text-white/60 sm:gap-2 sm:text-sm" aria-label="Breadcrumb">
            <Link href="/" className="transition-colors hover:text-[#c5dac2]">Home</Link>
            <ChevronRight className="size-3" />
            <Link href="/products" className="transition-colors hover:text-[#c5dac2]">Shop</Link>
            <ChevronRight className="size-3" />
            <span className="text-[#c5dac2]">Cart</span>
          </nav>
        </div>
      </section>

      {/* ── Cart Content ─────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[1440px] px-4 pt-6 sm:pt-10 lg:px-8">
        <CartWorkspace />
      </section>
    </div>
  );
}
