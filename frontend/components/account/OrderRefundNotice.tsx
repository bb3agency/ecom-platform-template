import { CheckCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { getOrderRefundNotice, type RefundNoticeOrder } from "@/lib/checkout-outcome";

interface OrderRefundNoticeProps {
  order: RefundNoticeOrder;
  className?: string;
}

/**
 * Customer-facing refund status for a cancelled (or refunded) prepaid order.
 * Renders nothing when there is no refund to talk about (COD, unpaid, active).
 * Order pages can mount it under the status header.
 */
export function OrderRefundNotice({ order, className }: OrderRefundNoticeProps) {
  const notice = getOrderRefundNotice(order);
  if (!notice) return null;
  const Icon = notice.kind === "refunded" ? CheckCircle : RotateCcw;
  return (
    <div
      role="status"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-border bg-muted px-4 py-3 text-left text-sm",
        className,
      )}
    >
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", notice.kind === "refunded" ? "text-success" : "text-primary")}
        aria-hidden
      />
      <div className="grid gap-1">
        <p className="font-bold text-foreground">{notice.title}</p>
        <p className="text-muted-foreground">{notice.body}</p>
      </div>
    </div>
  );
}
