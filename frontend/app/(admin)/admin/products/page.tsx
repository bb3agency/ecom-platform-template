"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminProductImportPanel } from "@/components/admin/AdminProductImportPanel";
import { AdminProductsList } from "@/components/admin/AdminProductsList";
import { buttonVariants } from "@/components/ui/button";
import { ConsolePage } from "@/components/ui/console";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";

export default function AdminProductsPage() {
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.productsWrite);
  return (
    <ConsolePage>
      <AdminPageHeader
        title="Products"
        actions={
          canWrite ? (
            <Link href="/admin/products/new" className={buttonVariants({ size: "lg" })}>
              <Plus aria-hidden /> Add product
            </Link>
          ) : null
        }
      />
      <AdminProductsList />
      <AdminProductImportPanel />
    </ConsolePage>
  );
}
