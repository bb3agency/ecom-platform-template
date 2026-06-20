import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Leaf,
  Sprout,
  ShieldCheck,
  Truck,
} from "lucide-react";

const HERO_STATS = [
  {
    value: "100%",
    label: "Chemical Free",
    desc: "Zero synthetic pesticides",
    icon: ShieldCheck,
    iconColor: "text-[#ec6e55]",
    iconBg: "bg-[#ec6e55]/10"
  },
  {
    value: "3-5 Days",
    label: "Farm to Door",
    desc: "Harvested to your kitchen",
    icon: Truck,
    iconColor: "text-[#23403d]",
    iconBg: "bg-[#23403d]/10"
  },
];

const HERO_CHIPS = [
  { icon: Leaf, label: "Pesticide-free" },
  { icon: Sprout, label: "Native seeds" },
  { icon: ShieldCheck, label: "Lab verified" },
];

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-[#eff5ee]">
      {/* Decorative blurs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-20 size-[420px] rounded-full bg-[#c5dac2] opacity-50 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 bottom-0 size-[480px] rounded-full bg-[#ffe0d4] opacity-60 blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-[1440px] px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-16 lg:px-8 lg:pb-24 lg:pt-20">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-12">
          {/* Left: editorial copy */}
          <div className="lg:col-span-7">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#23403d]/15 bg-white/70 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[#23403d] backdrop-blur-sm">
              <span className="flex size-2 items-center justify-center">
                <span className="absolute size-2 animate-ping rounded-full bg-[#ec6e55] opacity-70" />
                <span className="relative size-2 rounded-full bg-[#ec6e55]" />
              </span>
              New harvest live now
            </span>

            <h1 className="mt-5 font-heading text-4xl font-bold leading-[1.05] tracking-tight text-[#23403d] sm:text-5xl md:text-6xl lg:text-[68px]">
              Real food,{" "}
              <span className="relative inline-block">
                <span className="relative z-10">grown the way</span>
                <svg
                  aria-hidden
                  viewBox="0 0 300 14"
                  preserveAspectRatio="none"
                  className="absolute inset-x-0 -bottom-1 z-0 h-3 w-full text-[#ec6e55]/40"
                >
                  <path
                    d="M2 9 Q150 -3 298 8"
                    stroke="currentColor"
                    strokeWidth="6"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <br />
              your grandparents knew.
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-[#5b6b6a] sm:text-lg">
              Raghava Organics partners with small farms across Telangana to bring
              you fruits, vegetables, and spices grown without chemicals — and
              tested independently in certified labs before they reach your kitchen.
            </p>

            {/* Chips */}
            <div className="mt-6 flex flex-wrap gap-2">
              {HERO_CHIPS.map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-2 rounded-full border border-[#23403d]/10 bg-white px-3.5 py-1.5 text-xs font-semibold text-[#23403d]"
                >
                  <Icon className="size-3.5 text-[#ec6e55]" aria-hidden />
                  {label}
                </span>
              ))}
            </div>

            {/* CTAs */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/products"
                className="group inline-flex h-14 items-center justify-center gap-2 rounded-full bg-[#23403d] px-8 text-sm font-bold text-white shadow-lg shadow-[#23403d]/20 transition-all hover:-translate-y-0.5 hover:bg-[#1a302e] hover:shadow-xl"
              >
                Shop fresh produce
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>

            {/* Stat ribbon */}
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
              {HERO_STATS.map((stat) => (
                <div
                  key={stat.label}
                  className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-[#23403d]/10 bg-white/90 p-4 shadow-sm backdrop-blur-md transition-all hover:-translate-y-1 hover:shadow-md sm:p-5"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-white/50 to-transparent" />

                  <div className={`relative flex size-12 shrink-0 items-center justify-center rounded-xl ${stat.iconBg} ${stat.iconColor} transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3`}>
                    <stat.icon className="size-6" strokeWidth={1.5} />
                  </div>
                  <div className="relative z-10 flex flex-col">
                    <span className="font-heading text-2xl font-bold leading-none text-[#23403d]">
                      {stat.value}
                    </span>
                    <span className="mt-1 text-xs font-bold uppercase tracking-wider text-[#23403d]">
                      {stat.label}
                    </span>
                    <span className="mt-0.5 text-[11px] text-[#767676]">
                      {stat.desc}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: editorial visual stack */}
          <div className="relative lg:col-span-5">
            <div className="relative mx-auto aspect-[4/5] w-full max-w-md overflow-hidden rounded-[32px] bg-[#dbe8d8] shadow-[0_30px_80px_-30px_rgba(35,64,61,0.4)]">
              <Image
                src="https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=900&h=1125&fit=crop&q=80"
                alt="Fresh organic produce basket on a wooden farm table"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 450px"
                className="object-cover"
              />
              <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[#23403d]/60 to-transparent"
              />
              <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between gap-3 rounded-2xl border border-white/30 bg-white/90 p-3 backdrop-blur-md">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#ec6e55] text-white">
                    <Leaf className="size-5" />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#23403d]">
                      Farm Gallery
                    </p>
                    <p className="text-xs text-[#767676]">
                      A glimpse into our organic fields
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Floating sticker */}
            <div className="absolute -left-4 top-8 hidden rotate-[-8deg] rounded-2xl border border-[#23403d]/10 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-sm sm:flex sm:items-center sm:gap-2 md:-left-6">
              <Sprout className="size-5 text-[#23403d]" />
              <div>
                <p className="text-xs font-bold text-[#23403d]">Native seeds</p>
                <p className="text-[10px] text-[#767676]">No GMO · No hybrids</p>
              </div>
            </div>

            {/* Floating discount sticker */}
            <div className="absolute -right-2 bottom-12 hidden rotate-[6deg] flex-col items-center justify-center rounded-full border-4 border-white bg-[#ec6e55] p-4 text-white shadow-xl sm:flex md:-right-4">
              <span className="font-heading text-xl font-black leading-none">
                20%
              </span>
              <span className="text-[9px] font-bold uppercase tracking-wider">
                First order
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
