import { AdminProductsList } from "@/components/admin/AdminProductsList";
import { AdminProductImportPanel } from "@/components/admin/AdminProductImportPanel";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export default function AdminProductsPage() {
  return (
    <div className="flex flex-col gap-6 min-w-0">
      <AdminPageHeader title="Products" />
      <AdminProductsList />
      <AdminProductImportPanel />
    </div>
  );
}
