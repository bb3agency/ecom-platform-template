"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Router wrapper that defers navigation until after mount.
 * Avoids "Router action dispatched before initialization" in Next.js 16 dev.
 */
export function useSafeRouter() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    setIsReady(true);
  }, []);

  const push = useCallback(
    (href: string) => {
      if (!isReady) return;
      startTransition(() => {
        router.push(href);
      });
    },
    [isReady, router],
  );

  const replace = useCallback(
    (href: string) => {
      if (!isReady) return;
      startTransition(() => {
        router.replace(href);
      });
    },
    [isReady, router],
  );

  return {
    ...router,
    push,
    replace,
    isReady,
  };
}
