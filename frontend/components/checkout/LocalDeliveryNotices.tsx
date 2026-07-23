"use client";

/**
 * Blocking notice for product-level local delivery.
 *
 * Some products are delivered by the store itself and can never be handed to a courier. When
 * such a product is in the cart but the entered pincode is NOT on the store's local-delivery
 * whitelist, it cannot be shipped at all — checkout is blocked until the customer removes it.
 * This modal names exactly which items to remove.
 *
 * (A whitelisted pincode simply delivers the whole cart locally, so there is nothing to warn
 * about in that case — no split, no second order.)
 *
 * Engine component: it must never import a per-client theme file, so it is styled purely with
 * semantic tokens and inherits each store's palette automatically.
 */

import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** A product that cannot reach the customer's pincode, as reported by the backend. */
export interface BlockedLocalDeliveryProduct {
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
}

interface LocalDeliveryBlockedNoticeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pincode: string;
  products: BlockedLocalDeliveryProduct[];
  /** Sends the customer to the cart so they can remove the offending items. */
  onGoToCart?: () => void;
  /** Closes the notice and puts the cursor back in the pincode field. */
  onChangeAddress?: () => void;
}

export function LocalDeliveryBlockedNotice({
  open,
  onOpenChange,
  pincode,
  products,
  onGoToCart,
  onChangeAddress,
}: LocalDeliveryBlockedNoticeProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            Some items can&apos;t be delivered to this pincode
          </DialogTitle>
          <DialogDescription>
            We deliver these items ourselves and don&apos;t cover {pincode} yet. Remove them to
            continue, or use an address in an area we serve.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <h3 className="text-sm font-semibold text-foreground">
              {products.length === 1 ? "This item" : `These ${products.length} items`} must be
              removed
            </h3>
            <ul className="mt-2 flex flex-col gap-1">
              {products.map((product) => (
                <li key={product.variantId} className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{product.productName}</span>
                  {product.variantName ? (
                    <span className="text-muted-foreground"> · {product.variantName}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <p className="text-xs text-muted-foreground">
            Everything else in your cart can still be delivered to {pincode}.
          </p>
        </DialogBody>

        <DialogFooter>
          {/* Only offer "Change address" when the host can actually focus the field —
              otherwise the button would just close the dialog and read as a dead action. */}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              onChangeAddress?.();
            }}
          >
            {onChangeAddress ? "Change address" : "Close"}
          </Button>
          {onGoToCart ? (
            <Button type="button" onClick={onGoToCart}>
              Edit cart
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
