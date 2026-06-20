"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";
import { useAuthStore } from "@/stores/auth";

interface ProductViewTrackerProps {
  productId: string;
  productName?: string;
}

export function ProductViewTracker({ productId, productName }: ProductViewTrackerProps) {
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    trackEvent("PRODUCT_VIEW", { productId, productName }, userId);
  }, [productId, productName, userId]);

  return null;
}
