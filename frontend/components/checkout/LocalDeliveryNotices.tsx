"use client";

/**
 * Customer-facing explanations for product-level local delivery.
 *
 * Some products are delivered by the store itself and never handed to a courier. That
 * produces two situations the customer has to understand before paying:
 *
 *   SPLIT    their cart contains both kinds of product and the pincode IS served locally, so
 *            checkout will place TWO orders — LocalDeliverySplitNotice explains which items
 *            land in which order. It is dismissible and re-openable, during checkout and later
 *            from the order page.
 *   BLOCKED  their cart contains local-delivery-only products but the pincode is NOT served
 *            locally, so nothing can ship — LocalDeliveryBlockedNotice names exactly which
 *            items to remove. Dismissing it does not unblock checkout; the backend refuses the
 *            order until those items are gone.
 *
 * Both are engine components (they must never import a per-client theme file), so they are
 * styled purely with semantic tokens and inherit each store's palette automatically.
 */

import { useState } from "react";
import { PackageCheck, Truck, MapPin, AlertTriangle } from "lucide-react";
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
import { formatPrice } from "@/lib/format-price";
import type { DeliverySplit, FulfilmentGroupItem } from "@/types/cart";
import type { OrderGroupSibling } from "@/lib/orders-api";

function ItemLines({ items }: { items: FulfilmentGroupItem[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {items.map((item) => (
        <li
          key={item.variantId}
          className="flex items-start justify-between gap-3 text-sm text-muted-foreground"
        >
          <span className="min-w-0">
            <span className="font-medium text-foreground">{item.productName}</span>
            {item.variantName ? (
              <span className="text-muted-foreground"> · {item.variantName}</span>
            ) : null}
          </span>
          {item.quantity > 0 ? (
            <span className="shrink-0 tabular-nums">×{item.quantity}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

interface LocalDeliverySplitNoticeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  split: DeliverySplit;
  /** True on the order page, where the split has already happened (past tense copy). */
  past?: boolean;
}

export function LocalDeliverySplitNotice({
  open,
  onOpenChange,
  split,
  past = false,
}: LocalDeliverySplitNoticeProps) {
  const localGroup = split.groups.find((group) => group.channel === "LOCAL");
  const courierGroup = split.groups.find((group) => group.channel === "COURIER");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="size-4 text-primary" />
            {past ? "Why this cart became two orders" : "Your cart will be placed as two orders"}
          </DialogTitle>
          <DialogDescription>
            {past
              ? "Some items were delivered by us directly, so they were kept in their own order."
              : "Some items in your cart are delivered by us directly and cannot be shipped by a courier, so we split them into separate orders."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {localGroup ? (
            <section className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
              <div className="flex items-center gap-2">
                <MapPin className="size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
                <h3 className="text-sm font-semibold text-foreground">Order 1 · Delivered by us</h3>
              </div>
              {/* Charges/ETA belong to the live quote. On the order page the real figures are
                  already in the order summary, so this stays a plain explanation. */}
              <p className="mt-1 text-xs text-muted-foreground">
                {past
                  ? "We delivered these to you directly."
                  : `We deliver these to you directly, usually within ${localGroup.estimatedDays} ${
                      localGroup.estimatedDays === 1 ? "day" : "days"
                    }. Delivery charge ${formatPrice(localGroup.shippingCharge)}.`}
              </p>
              <ItemLines items={localGroup.items} />
            </section>
          ) : null}

          {courierGroup ? (
            <section className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-2">
                <Truck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <h3 className="text-sm font-semibold text-foreground">Order 2 · Shipped by courier</h3>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {past
                  ? "These were shipped to your address by courier."
                  : `Shipped to your address in about ${courierGroup.estimatedDays} ${
                      courierGroup.estimatedDays === 1 ? "day" : "days"
                    }. Shipping charge ${formatPrice(courierGroup.shippingCharge)}.`}
              </p>
              <ItemLines items={courierGroup.items} />
            </section>
          ) : null}

          {!past && (
            <p className="flex items-start gap-2 rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
              <PackageCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                You still pay once — a single payment covers both orders. You can track each
                order separately from your orders page.
              </span>
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            {past ? "Close" : "Got it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Order-page entry point for the split explanation.
 *
 * Renders nothing for ordinary orders. For an order that came from a split cart it shows a
 * compact banner plus a link that re-opens the full explanation — so the customer can
 * understand "why are there two orders?" at any time, not only during checkout.
 *
 * Mount it on the customer order detail page and pass `order.groupOrders` straight through.
 */
export function OrderSplitNotice({ groupOrders }: { groupOrders?: OrderGroupSibling[] }) {
  const [open, setOpen] = useState(false);

  // Only a genuine split (more than one order in the group) is worth explaining.
  if (!groupOrders || groupOrders.length < 2) return null;

  const sibling = groupOrders.find((entry) => !entry.isCurrent);
  const split: DeliverySplit = {
    mode: "SPLIT",
    groups: groupOrders.map((entry) => ({
      channel: entry.channel,
      // The order page shows real per-order money in its own summary; the modal here is an
      // explanation of WHAT went where, so charges are not repeated.
      shippingCharge: 0,
      estimatedDays: 1,
      items: entry.items.map((item, index) => ({
        variantId: `${entry.id}:${index}`,
        productName: item.productName,
        variantName: item.variantName,
        sku: "",
        quantity: item.quantity,
      })),
    })),
  };

  return (
    <>
      <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm">
        <p className="font-medium text-foreground">
          This was part of a two-order checkout.
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Items we deliver ourselves were placed as a separate order
          {sibling ? ` (${sibling.orderNumber})` : ""}. You paid once for both.
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1.5 text-xs font-bold text-sky-700 underline underline-offset-2 hover:no-underline dark:text-sky-400"
        >
          See what went in each order
        </button>
      </div>
      <LocalDeliverySplitNotice open={open} onOpenChange={setOpen} split={split} past />
    </>
  );
}

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
}

export function LocalDeliveryBlockedNotice({
  open,
  onOpenChange,
  pincode,
  products,
  onGoToCart,
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
            <ItemLines items={products.map((product) => ({ ...product, quantity: 0 }))} />
          </section>

          <p className="text-xs text-muted-foreground">
            Everything else in your cart can still be delivered to {pincode}.
          </p>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Change address
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
