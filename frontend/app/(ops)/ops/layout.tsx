import type { ReactNode } from "react";
import type { Viewport } from "next";
import { OpsRootLayout } from "@/components/ops/OpsRootLayout";
import { NOINDEX_METADATA } from "@/lib/seo";

export const metadata = NOINDEX_METADATA;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

interface OpsLayoutProps {
  children: ReactNode;
}

export default function OpsLayout({ children }: OpsLayoutProps) {
  return <OpsRootLayout>{children}</OpsRootLayout>;
}
