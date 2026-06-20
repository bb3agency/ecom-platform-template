"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import { useAuthStore } from "@/stores/auth";

export function CheckoutStartedTracker() {
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    trackEvent("CHECKOUT_STARTED", undefined, userId);
  }, [userId]);

  return null;
}
