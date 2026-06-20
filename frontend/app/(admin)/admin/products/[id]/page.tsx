import { AdminProductEditor } from "@/components/admin/AdminProductEditor";

interface AdminProductDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminProductDetailPage({
  params,
}: AdminProductDetailPageProps) {
  const { id } = await params;
  return <AdminProductEditor productId={id} />;
}
