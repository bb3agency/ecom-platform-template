"use client";

import { useParams } from "next/navigation";
import { AdminCustomerDetailPanel } from "@/components/admin/AdminCustomerDetailPanel";

export default function AdminCustomerDetailPage() {
  const params = useParams<{ id: string }>();
  return <AdminCustomerDetailPanel customerId={params.id} />;
}
