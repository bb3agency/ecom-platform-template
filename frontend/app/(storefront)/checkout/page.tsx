import type { Metadata } from "next";
import { connection } from "next/server";
import Script from "next/script";
import Link from "next/link";
import { Check, ChevronLeft, Lock } from "lucide-react";
import { CheckoutForm } from "@/components/checkout/CheckoutForm";
import { CheckoutStartedTracker } from "@/components/checkout/CheckoutStartedTracker";
import { NOINDEX_METADATA } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Checkout",
  ...NOINDEX_METADATA,
};

const STEPS = [
  { label: "Cart", state: "done" },
  { label: "Details", state: "current" },
  { label: "Payment", state: "todo" },
] as const;

/**
 * Checkout keeps the client's brand (it is customer-facing) but drops marketing
 * chrome: a compact header and progress line, then the form. Payment methods,
 * minimum order and delivery estimates are shown once, inside the form, where
 * the shopper acts on them.
 */
export default async function CheckoutPage() {
  await connection();

  return (
    <div className="min-h-screen bg-muted/40">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" />
      <CheckoutStartedTracker />

      <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-5 sm:pt-8 lg:px-8">
        <header className="mb-5 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <Link
              href="/cart"
              className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="size-4" aria-hidden />
              Back to cart
            </Link>
            <h1 className="flex items-center gap-2 font-heading text-2xl font-bold text-foreground sm:text-3xl">
              Checkout
              <Lock className="size-4 text-muted-foreground" aria-label="Secure checkout" />
            </h1>
          </div>

          <ol className="flex items-center gap-2 text-sm" aria-label="Checkout progress">
            {STEPS.map((step, index) => (
              <li key={step.label} className="flex items-center gap-2">
                <span
                  aria-current={step.state === "current" ? "step" : undefined}
                  className={
                    step.state === "current"
                      ? "font-semibold text-foreground"
                      : step.state === "done"
                        ? "inline-flex items-center gap-1 text-muted-foreground"
                        : "text-muted-foreground"
                  }
                >
                  {step.state === "done" ? <Check className="size-3.5" aria-hidden /> : null}
                  {step.label}
                </span>
                {index < STEPS.length - 1 ? <span aria-hidden className="h-px w-5 bg-border sm:w-8" /> : null}
              </li>
            ))}
          </ol>
        </header>

        <CheckoutForm />
      </div>
    </div>
  );
}
