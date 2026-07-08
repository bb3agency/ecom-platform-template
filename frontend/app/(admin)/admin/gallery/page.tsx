import { AdminGalleryManager } from "@/components/admin/AdminGalleryManager";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export default function AdminGalleryPage() {
  return (
    <div className="flex flex-col gap-6 min-w-0">
      <AdminPageHeader title="Gallery" />
      <AdminGalleryManager />
    </div>
  );
}
