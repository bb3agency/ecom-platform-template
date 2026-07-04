import { AdminDevToolsGate } from "@/components/admin/AdminDevToolsGate";
import { AdminMutationPanel } from "@/components/admin/AdminMutationPanel";

export default function AdminCatalogWritePage() {
  return (
    <AdminDevToolsGate title="Catalog write surfaces">
      <div className="grid min-w-0 grid-cols-1 gap-6">
        <header className="rounded-lg border border-border p-4">
          <h2 className="font-heading text-xl font-semibold">Catalog write surfaces</h2>
          <p className="text-sm text-muted-foreground">
            Developer JSON panels. Use the merchant product editor at /admin/products for normal
            catalog work.
          </p>
        </header>

        <AdminMutationPanel
          title="Create product"
          endpoint="/admin/products"
          payloadLabel="POST payload"
          payloadTemplate='{"name":"Sample Product","slug":"sample-product","description":"Ops-admin contract test","categoryId":"","isFeatured":false}'
        />

        <AdminMutationPanel
          title="Patch product"
          endpoint="/admin/products/<product-id>"
          payloadLabel="PATCH payload"
          payloadTemplate='{"name":"Updated Product Name"}'
          method="PATCH"
        />

        <AdminMutationPanel
          title="Create category"
          endpoint="/admin/categories"
          payloadLabel="POST payload"
          payloadTemplate='{"name":"Sample Category","slug":"sample-category"}'
        />

        <AdminMutationPanel
          title="Patch category"
          endpoint="/admin/categories/<category-id>"
          payloadLabel="PATCH payload"
          payloadTemplate='{"name":"Updated Category Name"}'
          method="PATCH"
        />

        <AdminMutationPanel
          title="Patch inventory variant"
          endpoint="/admin/inventory/<variant-id>"
          payloadLabel="PATCH payload"
          payloadTemplate='{"quantity":25,"lowStockThreshold":5}'
          method="PATCH"
        />

        <AdminMutationPanel
          title="Delete product variant"
          endpoint="/admin/products/PRODUCT_ID/variants/VARIANT_ID"
          method="DELETE"
          payloadLabel="No body required (disabled in UI if last variant)"
          payloadTemplate=""
        />
      </div>
    </AdminDevToolsGate>
  );
}
