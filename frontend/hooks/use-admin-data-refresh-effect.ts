"use client";

import { useEffect, useRef } from "react";
import {
  subscribeAdminDataRefresh,
  type AdminDataScope,
} from "@/lib/admin-data-refresh";

/** Re-run `reload` when another admin component notifies a matching data scope. */
export function useAdminDataRefreshEffect(
  reload: () => void | Promise<void>,
  scope: AdminDataScope | AdminDataScope[],
): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const scopeKey = Array.isArray(scope) ? scope.join("|") : scope;

  useEffect(() => {
    const resolvedScope: AdminDataScope | AdminDataScope[] = scopeKey.includes("|")
      ? (scopeKey.split("|") as AdminDataScope[])
      : (scopeKey as AdminDataScope);

    return subscribeAdminDataRefresh(resolvedScope, () => {
      void reloadRef.current();
    });
  }, [scopeKey]);
}
