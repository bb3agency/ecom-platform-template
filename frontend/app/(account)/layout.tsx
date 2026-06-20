import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { AccountGuard } from "@/components/auth/AccountGuard";
import { NOINDEX_METADATA } from "@/lib/seo";

export const metadata = NOINDEX_METADATA;

interface AccountLayoutProps {
  children: ReactNode;
}

export default function AccountLayout({ children }: AccountLayoutProps) {
  return (
    <AccountGuard>
      <div className="flex flex-col bg-[#eff5ee] min-h-screen pb-16">
        {/* ── Page Header Banner ──────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-[#dbe8d8] py-8 md:py-20">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-center px-4 text-center lg:px-8">
            <h1 className="mb-3 font-heading text-2xl font-bold text-[#23403d] sm:mb-4 sm:text-4xl md:text-5xl">
              My Account
            </h1>
            <nav className="flex items-center gap-1.5 text-xs font-bold text-[#767676] sm:gap-2 sm:text-sm" aria-label="Breadcrumb">
              <Link href="/" className="hover:text-[#ec6e55] transition-colors">Home</Link>
              <ChevronRight className="size-3" />
              <span className="text-[#ec6e55]">My Account</span>
            </nav>
          </div>
          {/* Decorative elements */}
          <div className="absolute -bottom-16 -right-16 size-64 rounded-full bg-[#c5dac2] opacity-40 blur-3xl" aria-hidden />
          <div className="absolute -left-16 top-0 size-48 rounded-full bg-white opacity-40 blur-3xl" aria-hidden />
        </section>

        {/* ── Main Content ──────────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-[1440px] px-4 pt-6 sm:pt-12 lg:px-8">
          <div className="grid gap-4 sm:gap-8 lg:grid-cols-[250px_1fr] lg:items-start">
            <nav className="flex flex-row lg:flex-col overflow-x-auto lg:overflow-x-visible gap-1.5 sm:gap-2 rounded-[20px] bg-white p-3 sm:p-4 lg:p-6 shadow-sm scrollbar-none" aria-label="Account">
              <Link href="/dashboard" className="rounded-lg px-3 py-2.5 text-xs font-bold text-[#23403d] transition-colors hover:bg-[#faf3ef] hover:text-[#ec6e55] whitespace-nowrap flex-1 text-center lg:text-left sm:px-4 sm:py-3 sm:text-sm">Dashboard</Link>
              <Link href="/orders" className="rounded-lg px-3 py-2.5 text-xs font-bold text-[#23403d] transition-colors hover:bg-[#faf3ef] hover:text-[#ec6e55] whitespace-nowrap flex-1 text-center lg:text-left sm:px-4 sm:py-3 sm:text-sm">Orders</Link>
              <Link href="/settings" className="rounded-lg px-3 py-2.5 text-xs font-bold text-[#23403d] transition-colors hover:bg-[#faf3ef] hover:text-[#ec6e55] whitespace-nowrap flex-1 text-center lg:text-left sm:px-4 sm:py-3 sm:text-sm">Settings</Link>
            </nav>
            <div className="rounded-[20px] bg-white p-4 shadow-sm sm:p-6 lg:p-8">
              {children}
            </div>
          </div>
        </section>
      </div>
    </AccountGuard>
  );
}
