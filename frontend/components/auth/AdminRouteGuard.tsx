"use client";


import type { ReactNode } from "react";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { redirectToAdminHome } from "@/lib/admin-auth-navigation";
import { canViewAdminPath } from "@/lib/permissions";

interface AdminRouteGuardProps {
  children: ReactNode;
}

export function AdminRouteGuard({ children }: AdminRouteGuardProps) {
  const pathname = usePathname();
  const { adminUser } = useAdminAuth();
  const allowed = canViewAdminPath(adminUser, pathname);

  useEffect(() => {
    if (!allowed) {
      redirectToAdminHome();
    }
  }, [allowed]);

  if (!allowed) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Redirecting…
      </p>
    );
  }

  return <>{children}</>;
}
