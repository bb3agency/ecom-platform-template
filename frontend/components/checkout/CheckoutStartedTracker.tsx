"use client";

import { useEffect, useRef } from "react";
import { trackEvent } from "@/lib/analytics";
import { useAuthStore } from "@/stores/auth";

/** Fires CHECKOUT_STARTED once per checkout visit, after the session check settles. */
export function CheckoutStartedTracker() {
  const userId = useAuthStore((s) => s.user?.id);
  const sessionStatus = useAuthStore((s) => s.storefrontSessionStatus);
  const sentRef = useRef(false);

  useEffect(() => {
    // Waiting for the restore avoids a second event when userId goes undefined → set.
    if (sentRef.current || sessionStatus === "checking") return;
    sentRef.current = true;
    trackEvent("CHECKOUT_STARTED", undefined, userId);
  }, [sessionStatus, userId]);

  return null;
}
