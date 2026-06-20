import Link from "next/link";
import { ChevronRight, Truck, MapPin, Clock, PackageCheck, AlertCircle, Leaf } from "lucide-react";
import { APP_NAME } from "@/lib/constants";

export const metadata = {
  title: `Shipping Policy — ${APP_NAME}`,
  description:
    "Delivery areas, charges, timelines, and how we handle cold-chain dispatch for your chemical-free produce orders.",
};

const SECTIONS = [
  {
    icon: MapPin,
    title: "1. Delivery Areas",
    content:
      "We deliver certified farm-fresh, chemical-free produce to serviceable pincodes within Hyderabad and surrounding districts of Telangana, India. Enter your delivery pincode at checkout — we will instantly confirm whether we can reach you. We are actively expanding to new areas.",
  },
  {
    icon: Truck,
    title: "2. Shipping Charges & Thresholds",
    content:
      "Our shipping fee and any free-delivery threshold are calculated at checkout based on your order total, weight, and the active configuration set by our operations team. You will always see the exact amount before placing your order — there are no hidden fees.",
  },
  {
    icon: Clock,
    title: "3. Delivery Schedule & Lead Time",
    content:
      "Orders are harvested and dispatched early morning to preserve cold-chain integrity. Once your order ships, you will receive a real-time tracking AWB via email or WhatsApp. Standard delivery takes 1–2 business days within Hyderabad. Delivery to surrounding areas may take up to 3 business days.",
  },
  {
    icon: PackageCheck,
    title: "4. Order Processing",
    content:
      "Orders placed before 6 PM are typically processed and dispatched the following morning. Orders placed on Sundays or public holidays are processed the next working day. You will receive an order confirmation email immediately after placing your order.",
  },
  {
    icon: Leaf,
    title: "5. Cold-Chain Handling",
    content:
      "All perishable produce is packed in insulated, eco-friendly packaging and dispatched using cold-chain couriers. We do not ship produce that has sat in a warehouse — your order is harvested within 48 hours of dispatch to ensure maximum freshness and nutritional value.",
  },
  {
    icon: AlertCircle,
    title: "6. Failed Deliveries",
    content:
      "If a delivery attempt is unsuccessful (no one available, locked premises), our courier will attempt re-delivery once. For perishable orders that cannot be delivered, we will contact you to arrange an alternative. We are not liable for spoilage caused by a missed delivery that was not reported to us within 24 hours.",
  },
];

export default function ShippingPolicyPage() {
  return (
    <div className="flex flex-col bg-[#eff5ee] min-h-screen pb-16">
      {/* ── Page Header Banner ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#dbe8d8] py-10 md:py-20">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-center px-4 text-center lg:px-8">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[#ec6e55]">
            Policies
          </p>
          <h1 className="mb-3 font-heading text-3xl font-bold text-[#23403d] sm:mb-4 sm:text-4xl md:text-5xl">
            Shipping Policy
          </h1>
          <nav
            className="flex items-center gap-1.5 text-xs font-bold text-[#767676] sm:gap-2 sm:text-sm"
            aria-label="Breadcrumb"
          >
            <Link href="/" className="transition-colors hover:text-[#ec6e55]">
              Home
            </Link>
            <ChevronRight className="size-3" />
            <span className="text-[#ec6e55]">Shipping Policy</span>
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
              <strong className="text-[#23403d]">Questions about your delivery?</strong>{" "}
              Contact us at{" "}
              <a
                href="mailto:hello@raghavaorganics.com"
                className="font-bold text-[#ec6e55] hover:underline"
              >
                hello@raghavaorganics.com
              </a>{" "}
              or call{" "}
              <a
                href="tel:+919440445006"
                className="font-bold text-[#ec6e55] hover:underline"
              >
                +91 94404 45006
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
