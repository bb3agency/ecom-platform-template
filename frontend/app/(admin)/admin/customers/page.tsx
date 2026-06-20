"use client";

import { useState } from "react";
import { AdminCustomersList } from "@/components/admin/AdminCustomersList";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  defaultDateRange,
  type DateRange,
} from "@/components/admin/AdminDateRangePicker";

export default function AdminCustomersPage() {
  const [range, setRange] = useState<DateRange>(defaultDateRange);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Customers"
        range={range}
        onRangeChange={setRange}
      />
      <AdminCustomersList from={range.from} to={range.to} />
    </div>
  );
}
