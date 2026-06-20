import type { ReactNode } from "react";
import { AdminRouteGuard } from "@/components/auth/AdminRouteGuard";
import { AdminSessionWarning } from "@/components/auth/AdminSessionWarning";
import { NOINDEX_METADATA } from "@/lib/seo";

export const metadata = NOINDEX_METADATA;

interface AdminLayoutProps {
  children: ReactNode;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <>
      <AdminSessionWarning />
      <AdminRouteGuard>{children}</AdminRouteGuard>
    </>
  );
}
