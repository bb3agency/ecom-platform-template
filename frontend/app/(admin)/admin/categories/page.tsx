import { AdminCategoriesList } from "@/components/admin/AdminCategoriesList";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export default function AdminCategoriesPage() {
  return (
    <div className="flex flex-col gap-6 min-w-0">
      <AdminPageHeader title="Categories" />
      <AdminCategoriesList />
    </div>
  );
}
