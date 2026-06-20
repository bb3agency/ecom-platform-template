import type { ReactNode } from "react";
import Link from "next/link";
import { isAdminDevToolsEnabled } from "@/lib/admin-dev-tools";

export function AdminDevToolsGate({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  if (!isAdminDevToolsEnabled()) {
    return (
      <section className="rounded-lg border border-border p-6 text-sm">
        <h2 className="font-heading text-xl font-semibold">{title}</h2>
        <p className="mt-2 text-muted-foreground">
          This developer surface is hidden in merchant mode. Set{" "}
          <code className="rounded bg-muted px-1">NEXT_PUBLIC_ADMIN_DEV_TOOLS=true</code> in{" "}
          <code className="rounded bg-muted px-1">frontend/.env.local</code> to enable it locally.
        </p>
        <Link href="/admin" className="mt-4 inline-block text-primary hover:underline">
          Back to dashboard
        </Link>
      </section>
    );
  }

  return <>{children}</>;
}
