import Link from "next/link";
import { ChevronRight, Eye, Database, Share2, Cookie, Lock, UserCheck, Mail } from "lucide-react";
import { APP_NAME } from "@/lib/constants";

export const metadata = {
  title: `Privacy Policy — ${APP_NAME}`,
  description:
    "How Raghava Organics collects, uses, stores, and protects your personal information when you shop for chemical-free produce.",
};

const SECTIONS = [
  {
    icon: Eye,
    title: "1. Information We Collect",
    content:
      "We collect information you provide directly: name, email address, mobile number, and delivery address when you register or place an order. We also automatically collect technical data such as IP address, device type, and browsing behaviour via cookies to improve site performance.",
  },
  {
    icon: Database,
    title: "2. How We Use Your Information",
    content:
      "Your information is used to: process and deliver your orders; send order confirmations, shipping updates, and OTP messages; provide customer support; and personalise your shopping experience. We do not use your data for automated profiling or make decisions with legal effect without human review.",
  },
  {
    icon: Share2,
    title: "3. Data Sharing",
    content:
      "We share your delivery address and contact number with our courier partners (Delhivery, Shiprocket, or equivalent) solely to fulfil your delivery. We share payment details with Razorpay for transaction processing. We do not sell your personal data to third parties, ever.",
  },
  {
    icon: Cookie,
    title: "4. Cookies",
    content:
      "We use essential cookies to maintain your session and cart. Optional analytics cookies (e.g., Google Analytics) are loaded only with your consent. You can manage cookie preferences in your browser settings. Disabling essential cookies may affect site functionality.",
  },
  {
    icon: Lock,
    title: "5. Data Security",
    content:
      "All data in transit is encrypted via HTTPS/TLS. Payment information is processed entirely by Razorpay and is not stored on our servers. Access tokens are held in memory only and never written to browser storage. We apply industry-standard technical and organisational measures to protect your data.",
  },
  {
    icon: UserCheck,
    title: "6. Your Rights",
    content:
      "Under applicable Indian data protection law, you have the right to access, correct, or delete the personal data we hold about you. You can update your name, phone number, and delivery addresses directly from your account settings. To request a full data export or account deletion, contact us at hello@raghavaorganics.com.",
  },
  {
    icon: Mail,
    title: "7. Contact & Updates",
    content:
      "We may update this policy as our practices evolve. Material changes will be communicated by email to registered customers. Continued use of the site after a policy update constitutes acceptance. For privacy questions or concerns, contact us at hello@raghavaorganics.com.",
  },
];

export default function PrivacyPage() {
  return (
    <div className="flex flex-col bg-[#eff5ee] min-h-screen pb-16">
      {/* ── Page Header Banner ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#dbe8d8] py-10 md:py-20">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-center px-4 text-center lg:px-8">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[#ec6e55]">
            Legal
          </p>
          <h1 className="mb-3 font-heading text-3xl font-bold text-[#23403d] sm:mb-4 sm:text-4xl md:text-5xl">
            Privacy Policy
          </h1>
          <nav
            className="flex items-center gap-1.5 text-xs font-bold text-[#767676] sm:gap-2 sm:text-sm"
            aria-label="Breadcrumb"
          >
            <Link href="/" className="transition-colors hover:text-[#ec6e55]">
              Home
            </Link>
            <ChevronRight className="size-3" />
            <span className="text-[#ec6e55]">Privacy Policy</span>
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
              <strong className="text-[#23403d]">Privacy questions?</strong>{" "}
              Email us at{" "}
              <a
                href="mailto:hello@raghavaorganics.com"
                className="font-bold text-[#ec6e55] hover:underline"
              >
                hello@raghavaorganics.com
              </a>
              . Also read our{" "}
              <Link href="/terms" className="font-bold text-[#ec6e55] hover:underline">
                Terms &amp; Conditions
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
