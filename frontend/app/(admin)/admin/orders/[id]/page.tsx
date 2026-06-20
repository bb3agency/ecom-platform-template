import { AdminOrderDetailPageClient } from "@/components/admin/AdminOrderDetailPageClient";

interface AdminOrderDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminOrderDetailPage({ params }: AdminOrderDetailPageProps) {
  const { id } = await params;
  return <AdminOrderDetailPageClient orderId={id} />;
}
