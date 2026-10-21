"use client";

import { useState } from "react";
import Link from "next/link";
import { KanbanSquare } from "lucide-react";

import { AdminOrdersList } from "@/components/admin/AdminOrdersList";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { allTimeRange, defaultDateRange, type DateRange } from "@/components/admin/AdminDateRangePicker";
import { buttonVariants } from "@/components/ui/button";
import { ConsolePage } from "@/components/ui/console";

export default function AdminOrdersPage() {
  // `?range=all` (from dashboard "needs attention" links) opens the full history so
  // the list matches the all-time count that was clicked.
  const [range, setRange] = useState<DateRange>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("range") === "all"
      ? allTimeRange()
      : defaultDateRange(),
  );

  return (
    <ConsolePage>
      <AdminPageHeader
        title="Orders"
        range={range}
        onRangeChange={setRange}
        actions={
          <Link href="/admin/orders/board" className={buttonVariants({ variant: "outline", size: "lg" })}>
            <KanbanSquare aria-hidden />
            <span className="sr-only sm:not-sr-only">Board</span>
          </Link>
        }
      />
      <AdminOrdersList from={range.from} to={range.to} />
    </ConsolePage>
  );
}
