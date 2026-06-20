import type { ReactNode } from "react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { StoreConfigProvider } from "@/components/providers/StoreConfigProvider";
import { getStoreCategories } from "@/lib/categories";
import { getPublicStoreConfig } from "@/lib/storefront-settings";

interface StorefrontLayoutProps {
  children: ReactNode;
}

export default async function StorefrontLayout({ children }: StorefrontLayoutProps) {
  const [categories, storeConfig] = await Promise.all([
    getStoreCategories(),
    getPublicStoreConfig(),
  ]);

  return (
    <StoreConfigProvider config={storeConfig}>
      <Header
        categories={categories}
        minOrderValuePaise={storeConfig.minOrderValuePaise}
      />
      <main className="flex-1">{children}</main>
      <Footer categories={categories} />
    </StoreConfigProvider>
  );
}
