"use client";

import { useState } from "react";
import { AdminBulkInventoryForm } from "@/components/admin/AdminBulkInventoryForm";
import { AdminInventoryHistoryPanel } from "@/components/admin/AdminInventoryHistoryPanel";
import { AdminInventoryList } from "@/components/admin/AdminInventoryList";
import { AdminLowStockList } from "@/components/admin/AdminLowStockList";

export function AdminInventoryPageClient() {
  const [historyVariantId, setHistoryVariantId] = useState("");

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <AdminInventoryList onViewHistory={setHistoryVariantId} />
      <AdminLowStockList />
      <AdminInventoryHistoryPanel initialVariantId={historyVariantId} />
      <AdminBulkInventoryForm />
    </div>
  );
}
