import Link from "next/link";
import { ChevronRight, FileText, ShoppingBag, CreditCard, AlertCircle, Scale, Mail } from "lucide-react";
import { APP_NAME } from "@/lib/constants";

export const metadata = {
  title: `Terms & Conditions — ${APP_NAME}`,
  description:
    "Terms and conditions governing the use of the Raghava Organics storefront, placing orders, and purchasing chemical-free produce.",
};

const SECTIONS = [
  {
    icon: FileText,
    title: "1. Acceptance of Terms",
    content:
      "By accessing or using this website, creating an account, or placing an order, you agree to be bound by these Terms & Conditions and our Privacy Policy. If you do not agree, please do not use this service. These terms apply to all users of the site, including browsers, customers, and contributors.",
  },
  {
    icon: ShoppingBag,
    title: "2. Products & Availability",
    content:
      "All products listed are subject to availability. We reserve the right to limit quantities, discontinue products, or refuse orders at any time. Product images and descriptions are for illustrative purposes — natural variations in shape, size, and colour are expected in chemical-free, farm-fresh produce and do not constitute defects.",
  },
  {
    icon: CreditCard,
    title: "3. Pricing & Payment",
    content:
      "All prices are displayed inclusive of applicable GST and are denominated in Indian Rupees (₹). We reserve the right to change prices without prior notice. Payment is processed via Razorpay (prepaid) or collected on delivery (Cash on Delivery, where available). Completed payments are non-reversible except as outlined in our Return Policy.",
  },
  {
    icon: AlertCircle,
    title: "4. Order Cancellation",
    content:
      "Orders may be cancelled before dispatch without charge. Once dispatched, cancellations are not accepted for perishable produce. If we are unable to fulfil your order due to stock unavailability or delivery constraints, we will notify you and issue a full refund within 5–7 business days.",
  },
  {
    icon: Scale,
    title: "5. Limitation of Liability",
    content:
      "To the fullest extent permitted by law, Raghava Organics is not liable for any indirect, incidental, or consequential damages arising from the use of our products or website. Our total liability shall not exceed the amount paid for the order in question. We make no warranties beyond those required by applicable Indian consumer protection law.",
  },
  {
    icon: FileText,
    title: "6. Intellectual Property",
    content:
      "All content on this website — including text, images, logos, and product descriptions — is the intellectual property of Raghava Organics or its licensors. You may not copy, reproduce, or redistribute any content without prior written consent.",
  },
  {
    icon: Mail,
    title: "7. Governing Law",
    content:
      "These Terms & Conditions are governed by the laws of Telangana, India. Any disputes shall be subject to the exclusive jurisdiction of the courts in Hyderabad, Telangana. If you have a question or complaint, please contact us first at hello@raghavaorganics.com — we resolve most issues informally.",
  },
];

export default function TermsPage() {
  return (
    <div className="flex flex-col bg-[#eff5ee] min-h-screen pb-16">
      {/* ── Page Header Banner ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#dbe8d8] py-10 md:py-20">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-center px-4 text-center lg:px-8">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[#ec6e55]">
            Legal
          </p>
          <h1 className="mb-3 font-heading text-3xl font-bold text-[#23403d] sm:mb-4 sm:text-4xl md:text-5xl">
            Terms &amp; Conditions
          </h1>
          <nav
            className="flex items-center gap-1.5 text-xs font-bold text-[#767676] sm:gap-2 sm:text-sm"
            aria-label="Breadcrumb"
          >
            <Link href="/" className="transition-colors hover:text-[#ec6e55]">
              Home
            </Link>
            <ChevronRight className="size-3" />
            <span className="text-[#ec6e55]">Terms &amp; Conditions</span>
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
              <strong className="text-[#23403d]">Questions about our terms?</strong>{" "}
              Email us at{" "}
              <a
                href="mailto:hello@raghavaorganics.com"
                className="font-bold text-[#ec6e55] hover:underline"
              >
                hello@raghavaorganics.com
              </a>
              . Also see our{" "}
              <Link href="/privacy" className="font-bold text-[#ec6e55] hover:underline">
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link href="/returns" className="font-bold text-[#ec6e55] hover:underline">
                Return Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
