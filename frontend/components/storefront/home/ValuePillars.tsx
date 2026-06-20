import { Sprout, FlaskConical, Users, HeartHandshake, type LucideIcon } from "lucide-react";
import { SectionHeading } from "./SectionHeading";

interface Pillar {
  icon: LucideIcon;
  title: string;
  description: string;
  accent: string;
}

const PILLARS: Pillar[] = [
  {
    icon: Sprout,
    title: "Native seeds, not hybrids",
    description:
      "We work with heirloom varieties our grandparents grew — richer flavour, denser nutrition, and built for our soil.",
    accent: "bg-[#dbe8d8] text-[#23403d]",
  },
  {
    icon: FlaskConical,
    title: "Tested in independent labs",
    description:
      "Every batch is screened for 300+ pesticide residues by NABL-accredited labs before it ships from our facility.",
    accent: "bg-[#ffe0d4] text-[#23403d]",
  },
  {
    icon: HeartHandshake,
    title: "Farmer-first sourcing",
    description:
      "We pay 30–40% above mandi rates and lock annual contracts so farmers can invest in chemical-free practices.",
    accent: "bg-[#fff5db] text-[#23403d]",
  },
  {
    icon: Users,
    title: "Built on customer trust",
    description:
      "Over 10,000 families across India have made Raghava Organics part of their weekly kitchen. Reviews speak for us.",
    accent: "bg-[#e8f3ff] text-[#23403d]",
  },
];

export function ValuePillars() {
  return (
    <section className="bg-[#faf8f5]">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <SectionHeading
          eyebrow="Why Raghava Organics"
          title="Four uncompromising standards behind every order."
          description="We don't claim to be the cheapest. We claim to be honest about what's in your basket — and back it up with paperwork you can verify."
          align="center"
          className="mx-auto mb-12 max-w-3xl text-center lg:mb-16"
        />

        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map(({ icon: Icon, title, description, accent }, idx) => (
            <article
              key={title}
              className="group relative flex flex-col gap-4 rounded-3xl border border-[#23403d]/8 bg-white p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[#23403d]/20 hover:shadow-[0_24px_60px_-24px_rgba(35,64,61,0.25)] sm:p-7"
            >
              <div
                className={`flex size-14 items-center justify-center rounded-2xl ${accent} transition-transform group-hover:scale-110`}
              >
                <Icon className="size-6" aria-hidden />
              </div>

              <div className="flex flex-1 flex-col gap-2">
                <span className="font-mono text-[11px] font-bold tracking-wider text-[#ec6e55]">
                  0{idx + 1}
                </span>
                <h3 className="font-heading text-lg font-bold leading-tight text-[#23403d] sm:text-xl">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-[#5b6b6a]">
                  {description}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
