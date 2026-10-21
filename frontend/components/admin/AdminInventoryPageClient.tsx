"use client";

import { useState } from "react";
import { AdminBulkInventoryForm } from "@/components/admin/AdminBulkInventoryForm";
import { AdminInventoryHistoryPanel } from "@/components/admin/AdminInventoryHistoryPanel";
import { AdminInventoryList } from "@/components/admin/AdminInventoryList";
import { AdminLowStockList } from "@/components/admin/AdminLowStockList";
import { useUrlFilterState } from "@/hooks/use-url-filter-state";

export function AdminInventoryPageClient() {
  const [historyVariantId, setHistoryVariantId] = useState("");
  // `?stock=low|out` (dashboard "needs attention" links) puts the running-low list
  // first — it holds both low and out-of-stock variants, matching those counts.
  const [stock] = useUrlFilterState("stock", "", ["low", "out"]);
  const focusLowStock = stock !== "";

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      {focusLowStock ? <AdminLowStockList /> : null}
      <AdminInventoryList onViewHistory={setHistoryVariantId} />
      {focusLowStock ? null : <AdminLowStockList />}
      <AdminInventoryHistoryPanel initialVariantId={historyVariantId} />
      <AdminBulkInventoryForm />
    </div>
  );
}
