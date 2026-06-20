import { AdminConsoleShell } from "@/components/admin/AdminConsoleShell";
import type { ReactNode } from "react";

export const metadata = {
  title: "Admin Console",
  description: "Merchant management and store operations",
};

export default function AdminRootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AdminConsoleShell>{children}</AdminConsoleShell>;
}
