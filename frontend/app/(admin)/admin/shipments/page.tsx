"use client";

import { useState } from "react";
import { AdminShipmentsList } from "@/components/admin/AdminShipmentsList";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  defaultDateRange,
  type DateRange,
} from "@/components/admin/AdminDateRangePicker";

export default function AdminShipmentsPage() {
  const [range, setRange] = useState<DateRange>(defaultDateRange);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Shipments"
        range={range}
        onRangeChange={setRange}
      />
      <AdminShipmentsList from={range.from} to={range.to} />
    </div>
  );
}
