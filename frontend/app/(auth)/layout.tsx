import type { ReactNode } from "react";
import { NOINDEX_METADATA } from "@/lib/seo";

export const metadata = NOINDEX_METADATA;

interface AuthLayoutProps {
  children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-[#eff5ee] px-4 py-16 lg:px-8">
      <div className="w-full max-w-lg overflow-hidden rounded-[20px] bg-white shadow-xl">
        {children}
      </div>
    </div>
  );
}
