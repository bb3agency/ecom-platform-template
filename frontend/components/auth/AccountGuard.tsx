"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAccountSessionRestore } from "@/hooks/use-account-session-restore";

interface AccountGuardProps {
  children: ReactNode;
}

export function AccountGuard({ children }: AccountGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { status, accessToken } = useAccountSessionRestore();

  useEffect(() => {
    if (status === "failed") {
      const redirect = encodeURIComponent(pathname ?? "/dashboard");
      router.replace(`/login?redirect=${redirect}`);
    }
  }, [status, router, pathname]);

  if (status === "checking" || status === "restoring") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-[#23403d] border-t-transparent" aria-hidden />
          <p className="text-sm font-medium text-[#767676]" role="status" aria-live="polite">
            Restoring your session…
          </p>
        </div>
      </div>
    );
  }

  if (status === "failed" || !accessToken) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-[#767676]" role="status" aria-live="polite">
          Redirecting to sign in…
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
