import { AdminCategoryEditor } from "@/components/admin/AdminCategoryEditor";

interface AdminCategoryDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminCategoryDetailPage({
  params,
}: AdminCategoryDetailPageProps) {
  const { id } = await params;
  return <AdminCategoryEditor categoryId={id} />;
}
