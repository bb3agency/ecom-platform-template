"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Minus, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Faq {
  q: string;
  a: string;
}

interface FaqSectionProps {
  isCodEnabled?: boolean;
}

function buildFaqs(isCodEnabled: boolean): Faq[] {
  return [
    {
      q: 'What does "chemical free" actually mean here?',
      a: "Our partner farmers don't use synthetic pesticides, herbicides, or fertilizers. Soil is enriched with cow-based manure and crop rotation. Each batch is screened for 300+ pesticide residues by NABL-accredited labs before shipping. We can share the reports on request.",
    },
    {
      q: "Do you offer Cash on Delivery?",
      a: isCodEnabled
        ? "Yes — COD is available when enabled for your delivery pincode. You'll see the option at checkout if your address qualifies. Prepaid orders (UPI, cards, wallets) are accepted everywhere we ship."
        : "Cash on Delivery is currently unavailable. Prepaid orders (UPI, cards, wallets) are accepted everywhere we ship.",
    },
    {
      q: "What if I'm not satisfied with my order?",
      a: "If something arrives spoiled, damaged, or below the quality you expected, message us with a photo within 24 hours of delivery and we'll refund or replace it — no long forms, no back-and-forth.",
    },
  ];
}

export function FaqSection({ isCodEnabled = false }: FaqSectionProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const faqs = useMemo(() => buildFaqs(isCodEnabled), [isCodEnabled]);

  return (
    <section className="bg-white">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-16">
          {/* Sticky heading */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-32">
              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#dbe8d8] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#23403d]">
                <span
                  className="size-1.5 rounded-full bg-[#ec6e55]"
                  aria-hidden
                />
                Questions, answered
              </span>
              <h2 className="mt-4 font-heading text-3xl font-bold leading-[1.1] tracking-tight text-[#23403d] sm:text-4xl lg:text-5xl">
                Everything you wanted to ask before you order.
              </h2>
              <p className="mt-4 max-w-md text-base leading-relaxed text-[#5b6b6a]">
                We&apos;ve answered the ones we get most. If yours isn&apos;t
                here, our team replies on WhatsApp within an hour.
              </p>

              <Link
                href="https://wa.me/919440445006"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex h-12 items-center gap-2 rounded-full bg-[#23403d] px-6 text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:bg-[#1a302e] hover:shadow-lg"
              >
                <MessageCircle className="size-4" />
                Chat with us on WhatsApp
              </Link>
            </div>
          </div>

          {/* Accordion */}
          <div className="lg:col-span-7">
            <div className="flex flex-col gap-3">
              {faqs.map((faq, idx) => {
                const isOpen = openIndex === idx;
                return (
                  <div
                    key={faq.q}
                    className={cn(
                      "overflow-hidden rounded-2xl border bg-white transition-all duration-300",
                      isOpen
                        ? "border-[#23403d]/20 shadow-[0_12px_30px_-18px_rgba(35,64,61,0.25)]"
                        : "border-[#efe8e4]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenIndex(isOpen ? null : idx)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-[#faf8f5] sm:px-6 sm:py-6"
                      aria-expanded={isOpen}
                    >
                      <span className="text-base font-bold text-[#23403d] sm:text-lg">
                        {faq.q}
                      </span>
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
                          isOpen
                            ? "bg-[#23403d] text-white"
                            : "bg-[#eff5ee] text-[#23403d]",
                        )}
                        aria-hidden
                      >
                        {isOpen ? (
                          <Minus className="size-4" />
                        ) : (
                          <Plus className="size-4" />
                        )}
                      </span>
                    </button>
                    <div
                      className={cn(
                        "grid transition-all duration-300 ease-out",
                        isOpen
                          ? "grid-rows-[1fr] opacity-100"
                          : "grid-rows-[0fr] opacity-0",
                      )}
                    >
                      <div className="overflow-hidden">
                        <p className="px-5 pb-6 text-sm leading-relaxed text-[#5b6b6a] sm:px-6 sm:text-[15px]">
                          {faq.a}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
