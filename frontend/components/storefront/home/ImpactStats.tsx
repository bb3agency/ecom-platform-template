import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Leaf } from "lucide-react";

const IMPACT = [
  { value: "120+", label: "Partner farmers earning fair wages" },
  { value: "850", label: "Acres farmed without chemicals" },
  { value: "10k+", label: "Families fed every week" },
  { value: "300+", label: "Pesticides screened per batch" },
];

export function ImpactStats() {
  return (
    <section className="bg-[#eff5ee]">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <div className="relative overflow-hidden rounded-[32px] bg-white shadow-[0_30px_80px_-40px_rgba(35,64,61,0.3)]">
          <div className="grid grid-cols-1 lg:grid-cols-12">
            {/* Image */}
            <div className="relative aspect-[16/10] lg:col-span-5 lg:aspect-auto">
              <Image
                src="https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=900&h=1100&fit=crop&q=80"
                alt="Farmer holding fresh harvest from chemical-free farm"
                fill
                sizes="(max-width: 1024px) 100vw, 500px"
                className="object-cover"
              />
              <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white via-white/30 to-transparent lg:hidden"
              />
              <div
                aria-hidden
                className="absolute inset-y-0 right-0 hidden w-24 bg-gradient-to-l from-white to-transparent lg:block"
              />
            </div>

            {/* Stats */}
            <div className="lg:col-span-7">
              <div className="p-6 sm:p-10 lg:p-14">
                <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#dbe8d8] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-[#23403d]">
                  <Leaf className="size-3 text-[#ec6e55]" aria-hidden />
                  Real impact
                </span>

                <h2 className="mt-4 font-heading text-3xl font-bold leading-[1.1] tracking-tight text-[#23403d] sm:text-4xl">
                  Every order moves the needle.
                </h2>

                <p className="mt-4 max-w-xl text-base leading-relaxed text-[#5b6b6a]">
                  We measure success not by units shipped, but by the farmers
                  we&apos;ve helped transition off chemicals and the families
                  we&apos;ve fed with food they can trust.
                </p>

                <div className="mt-8 grid grid-cols-2 gap-6 sm:gap-8">
                  {IMPACT.map((item) => (
                    <div key={item.label} className="border-l-2 border-[#ec6e55] pl-4">
                      <p className="font-heading text-3xl font-bold text-[#23403d] sm:text-4xl">
                        {item.value}
                      </p>
                      <p className="mt-1 text-xs font-medium leading-snug text-[#767676] sm:text-sm">
                        {item.label}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-10">
                  <Link
                    href="/about"
                    className="group inline-flex h-12 items-center gap-2 rounded-full bg-[#23403d] px-6 text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:bg-[#1a302e] hover:shadow-lg"
                  >
                    Meet our farmers
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
