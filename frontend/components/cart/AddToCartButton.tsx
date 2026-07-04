"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { addCartItem } from "@/lib/cart-api";
import { useAuthStore } from "@/stores/auth";
import { useCartStore } from "@/stores/cart";
import { getApiErrorMessage } from "@/lib/error-messages";
import { toast } from "@/lib/toast";
import { trackEvent } from "@/lib/analytics";

interface AddToCartButtonProps {
  variantId: string;
  label?: string;
  quantity?: number;
  redirectTo?: string;
  className?: string;
  icon?: React.ReactNode;
}

export function AddToCartButton({
  variantId,
  label = "Add to cart",
  quantity = 1,
  redirectTo,
  className,
  icon,
}: AddToCartButtonProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setCart = useCartStore((s) => s.setCart);
  const markPendingMerge = useCartStore((s) => s.markPendingMerge);

  const handleClick = async () => {
    try {
      setIsSubmitting(true);
      const cart = await addCartItem({ variantId, quantity }, accessToken);
      setCart(cart);
      trackEvent("ADD_TO_CART", { variantId, quantity });
      if (!accessToken) {
        markPendingMerge();
      }
      if (redirectTo) {
        if (redirectTo === "/checkout" && !accessToken) {
          router.push("/login?redirect=/checkout");
        } else {
          router.push(redirectTo);
        }
      } else {
        // Only confirm via toast when we're staying on the page; a redirect is its own feedback.
        toast.success("Added to cart");
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // No wrapper element: callers place this button inside flex rows and rely on
  // flex-1/shrink-0 on the button itself — a wrapper div swallowed those classes
  // (unequal CTA widths on the PDP) and broke the card layouts.
  return (
    <button
      type="button"
      disabled={isSubmitting}
      onClick={handleClick}
      className={
        className ??
        "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground disabled:opacity-60"
      }
    >
      {icon ?? <ShoppingCart className="size-4 shrink-0" aria-hidden />}
      {isSubmitting ? "Adding…" : label}
    </button>
  );
}
