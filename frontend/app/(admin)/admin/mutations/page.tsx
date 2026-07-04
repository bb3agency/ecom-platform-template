import { AdminDevToolsGate } from "@/components/admin/AdminDevToolsGate";
import { AdminOrderMutations } from "@/components/admin/AdminOrderMutations";

export default function AdminMutationsPage() {
  return (
    <AdminDevToolsGate title="Order mutations (dev)">
      <div className="grid min-w-0 grid-cols-1 gap-6">
        <header className="grid min-w-0 grid-cols-1 gap-2 rounded-lg border border-border p-4">
          <h2 className="font-heading text-xl font-semibold">Order fulfillment (dev)</h2>
          <p className="text-sm text-muted-foreground">
            Legacy mutation console. Prefer /admin/orders/[id] for merchant workflows.
          </p>
        </header>
        <AdminOrderMutations />
      </div>
    </AdminDevToolsGate>
  );
}
