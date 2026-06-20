import Link from "next/link";
import { ChevronRight, RotateCcw, Clock, CreditCard, Camera, CheckCircle, XCircle } from "lucide-react";
import { APP_NAME } from "@/lib/constants";

export const metadata = {
  title: `Return Policy — ${APP_NAME}`,
  description:
    "How to raise a return request, what qualifies for a return, and how we process refunds for chemical-free produce orders.",
};

const SECTIONS = [
  {
    icon: Clock,
    title: "1. Return Window",
    content:
      "Due to the perishable nature of fresh fruits, vegetables, dairy, and other chemical-free produce, return or damage claims must be raised within 24 hours of delivery. Please inspect your order on arrival. Claims raised after 24 hours will not be accepted for perishable items.",
  },
  {
    icon: Camera,
    title: "2. Raising a Return Request",
    content:
      "Log in to your account, navigate to Order History, and select the delivered order. Tap 'Raise Return Request' on the relevant item. You will be asked to describe the issue and optionally attach a photo. Our quality team reviews all requests within 24 hours.",
  },
  {
    icon: CheckCircle,
    title: "3. Eligible Returns",
    content:
      "We accept returns or replacements for: damaged or bruised produce (beyond normal variation), incorrect items delivered, quality issues (evidence of non-organic contamination), or items that have visibly spoiled before their expected shelf life. We reserve the right to request photographic evidence.",
  },
  {
    icon: XCircle,
    title: "4. Non-Eligible Returns",
    content:
      "We cannot accept returns for: produce that has been stored incorrectly after delivery (non-refrigerated), natural variation in size, shape, or colour (this is expected in chemical-free farming), or items that were delivered in good condition and later damaged by the customer.",
  },
  {
    icon: CreditCard,
    title: "5. Refund Method",
    content:
      "Approved returns are refunded to the original payment method within 5–7 business days. Prepaid orders (Razorpay) are refunded to the source bank account or wallet. Cash on Delivery orders are issued a store credit, redeemable on your next order. Refund processing times may vary by payment provider.",
  },
  {
    icon: RotateCcw,
    title: "6. Replacement vs. Refund",
    content:
      "If you prefer a replacement over a refund, please indicate this when raising your request. Subject to stock availability, we will dispatch a fresh replacement at no extra cost. Replacements are processed with next-morning dispatch priority.",
  },
];

export default function ReturnPolicyPage() {
  return (
    <div className="flex flex-col bg-[#eff5ee] min-h-screen pb-16">
      {/* ── Page Header Banner ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#dbe8d8] py-10 md:py-20">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-center px-4 text-center lg:px-8">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[#ec6e55]">
            Policies
          </p>
          <h1 className="mb-3 font-heading text-3xl font-bold text-[#23403d] sm:mb-4 sm:text-4xl md:text-5xl">
            Return Policy
          </h1>
          <nav
            className="flex items-center gap-1.5 text-xs font-bold text-[#767676] sm:gap-2 sm:text-sm"
            aria-label="Breadcrumb"
          >
            <Link href="/" className="transition-colors hover:text-[#ec6e55]">
              Home
            </Link>
            <ChevronRight className="size-3" />
            <span className="text-[#ec6e55]">Return Policy</span>
          </nav>
          <p className="mt-3 text-xs font-medium text-[#23403d]/60">
            Last updated: June 2026
          </p>
        </div>
        <div
          className="absolute -bottom-16 -right-16 size-64 rounded-full bg-[#c5dac2] opacity-40 blur-3xl"
          aria-hidden
        />
        <div
          className="absolute -left-16 top-0 size-48 rounded-full bg-white opacity-40 blur-3xl"
          aria-hidden
        />
      </section>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-[1440px] px-4 pt-8 sm:pt-12 lg:px-8">
        <div className="grid gap-6 sm:gap-8">

          {/* Quick summary */}
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            {[
              { value: "24 hrs", label: "Claim window" },
              { value: "24 hrs", label: "Review time" },
              { value: "5–7 days", label: "Refund timeline" },
            ].map(({ value, label }) => (
              <div
                key={label}
                className="flex flex-col items-center justify-center rounded-[16px] bg-[#23403d] px-3 py-5 text-center sm:py-6"
              >
                <span className="font-heading text-xl font-bold text-white sm:text-2xl">
                  {value}
                </span>
                <span className="mt-1 text-[10px] font-bold uppercase tracking-wider text-white/70 sm:text-xs">
                  {label}
                </span>
              </div>
            ))}
          </div>

          <div className="rounded-[20px] bg-white p-6 shadow-sm sm:p-8 lg:p-12">
            <div className="grid gap-8">
              {SECTIONS.map(({ icon: Icon, title, content }) => (
                <div key={title} className="flex gap-4 sm:gap-6">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#eff5ee] mt-0.5">
                    <Icon className="size-5 text-[#ec6e55]" aria-hidden />
                  </div>
                  <div>
                    <h2 className="mb-2 font-heading text-lg font-bold text-[#23403d]">
                      {title}
                    </h2>
                    <p className="text-sm leading-relaxed text-[#767676]">{content}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 rounded-[16px] border border-[#e3ebe1] bg-[#faf9f7] p-5 sm:p-6">
              <p className="text-sm font-medium text-[#767676]">
                <strong className="text-[#23403d]">Need to raise a return?</strong>{" "}
                Go to{" "}
                <Link
                  href="/orders"
                  className="font-bold text-[#ec6e55] hover:underline"
                >
                  My Orders
                </Link>{" "}
                in your account, or contact us at{" "}
                <a
                  href="mailto:hello@raghavaorganics.com"
                  className="font-bold text-[#ec6e55] hover:underline"
                >
                  hello@raghavaorganics.com
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
