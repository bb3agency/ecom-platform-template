"use client";

import { useParams } from "next/navigation";
import { AdminReturnDetailPanel } from "@/components/admin/AdminReturnDetailPanel";

export default function AdminReturnRequestDetailPage() {
  const params = useParams<{ id: string }>();
  return <AdminReturnDetailPanel returnId={params.id} />;
}
