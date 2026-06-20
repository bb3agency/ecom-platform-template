import { getPublicStoreConfig } from "@/lib/storefront-settings";
import Link from "next/link";
import Image from "next/image";
import { ChevronRight, Leaf, Heart, Shield, Users, Sprout, Truck, Star } from "lucide-react";
import { APP_NAME } from "@/lib/constants";

export const metadata = {
  title: `About Us — ${APP_NAME}`,
  description:
    "We work directly with 120+ certified farmers across Telangana to bring you chemical-free, traceable produce. Every batch is lab-tested for 300+ pesticide residues.",
};

const VALUES = [
  {
    icon: Leaf,
    title: "100% Chemical Free",
    description:
      "Every product is grown without synthetic pesticides, herbicides, or chemical fertilisers. We test every batch in certified labs for 300+ pesticide residues before dispatch.",
  },
  {
    icon: Heart,
    title: "Farmer First",
    description:
      "We eliminate middlemen and pay farmers directly at fair prices — typically 30–40% above the market rate. Healthy farmers grow healthier food.",
  },
  {
    icon: Shield,
    title: "Quality Promise",
    description:
      "Not satisfied with your order? We replace it or refund it, no questions asked. Your trust is more important than a single transaction.",
  },
  {
    icon: Users,
    title: "Community Rooted",
    description:
      "We partner with small family farms, cooperatives, and tribal farming communities — people who have practised natural farming for generations.",
  },
];

const BASE_STATS = [
  { value: "120+", label: "Partner Farmers" },
  { value: "300+", label: "Pesticide Tests per Batch" },
  { value: "48 hrs", label: "Farm to Door" },
] as const;

const REVIEWS_STAT = { value: "4.8 ★", label: "Average Rating" } as const;

export default async function AboutPage() {
  const storeConfig = await getPublicStoreConfig();
  const stats = storeConfig.reviewsEnabled
    ? [...BASE_STATS, REVIEWS_STAT]
    : [...BASE_STATS];
  return (
    <div className="flex flex-col bg-[#eff5ee] min-h-screen pb-16">
      {/* ── Page Header Banner ──────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-[#dbe8d8] py-10 md:py-20">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-center px-4 text-center lg:px-8">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[#ec6e55]">
            Our Story
          </p>
          <h1 className="mb-3 font-heading text-3xl font-bold text-[#23403d] sm:mb-4 sm:text-4xl md:text-5xl">
            About {APP_NAME}
          </h1>
          <nav
            className="flex items-center gap-1.5 text-xs font-bold text-[#767676] sm:gap-2 sm:text-sm"
            aria-label="Breadcrumb"
          >
            <Link href="/" className="transition-colors hover:text-[#ec6e55]">
              Home
            </Link>
            <ChevronRight className="size-3" />
            <span className="text-[#ec6e55]">About Us</span>
          </nav>
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

          {/* Story card */}
          <div className="rounded-[20px] bg-white p-6 shadow-sm sm:p-8 lg:p-12">
            <div className="grid gap-8 lg:grid-cols-2 lg:gap-12 lg:items-center">
              <div>
                <p className="mb-3 text-xs font-bold uppercase tracking-widest text-[#ec6e55]">
                  Who we are
                </p>
                <h2 className="mb-4 font-heading text-2xl font-bold text-[#23403d] sm:text-3xl">
                  Farm-fresh chemical-free produce, direct to your doorstep
                </h2>
                <div className="space-y-4 text-sm font-medium leading-relaxed text-[#767676]">
                  <p>
                    Raghava Organics was founded on a single belief: every family deserves
                    access to food grown the way nature intended — without chemicals, without
                    shortcuts, and with full traceability from seed to table.
                  </p>
                  <p>
                    We work directly with <strong className="text-[#23403d]">120+ certified farmers</strong> across
                    Telangana who have committed to chemical-free, native-seed farming. Their
                    knowledge of the land, often passed down over generations, is irreplaceable.
                    We give them a market; they give you real food.
                  </p>
                  <p>
                    Every batch is lab-tested for <strong className="text-[#23403d]">300+ pesticide residues</strong> before
                    it leaves the farm. If it does not pass, it does not ship — period. Orders
                    are harvested and dispatched within 48 hours for peak freshness.
                  </p>
                </div>
              </div>
              <div className="relative overflow-hidden rounded-[20px] bg-[#faf3ef]">
                <Image
                  src="/images/product-placeholder.svg"
                  alt="Raghava Organics — fresh chemical-free produce"
                  width={600}
                  height={480}
                  className="mx-auto h-64 w-full object-contain p-8 lg:h-80"
                />
              </div>
            </div>
          </div>

          {/* Impact stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-6">
            {stats.map(({ value, label }) => (
              <div
                key={label}
                className="flex flex-col items-center justify-center rounded-[20px] bg-[#23403d] px-4 py-6 text-center sm:py-8"
              >
                <span className="font-heading text-2xl font-bold text-white sm:text-3xl">
                  {value}
                </span>
                <span className="mt-1.5 text-xs font-bold uppercase tracking-wider text-white/70">
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Values grid */}
          <div className="rounded-[20px] bg-white p-6 shadow-sm sm:p-8 lg:p-12">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[#ec6e55]">
              What we stand for
            </p>
            <h2 className="mb-8 font-heading text-2xl font-bold text-[#23403d] sm:text-3xl">
              Our values
            </h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:gap-8">
              {VALUES.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="flex gap-4 rounded-[16px] border border-[#e3ebe1] bg-[#faf9f7] p-5 sm:p-6"
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#eff5ee]">
                    <Icon className="size-5 text-[#ec6e55]" aria-hidden />
                  </div>
                  <div>
                    <h3 className="mb-1.5 font-heading text-base font-bold text-[#23403d]">
                      {title}
                    </h3>
                    <p className="text-sm leading-relaxed text-[#767676]">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Process steps */}
          <div className="rounded-[20px] bg-white p-6 shadow-sm sm:p-8 lg:p-12">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-[#ec6e55]">
              How it works
            </p>
            <h2 className="mb-8 font-heading text-2xl font-bold text-[#23403d] sm:text-3xl">
              From seed to your table
            </h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: Sprout, step: "1", title: "Certified Farming", desc: "Partner farmers grow using native seeds and zero chemicals on certified plots." },
                { icon: Star, step: "2", title: "Lab Testing", desc: "Every harvest is tested for 300+ pesticide residues before leaving the farm." },
                { icon: Leaf, step: "3", title: "Fresh Harvest", desc: "We harvest within 48 hours of your order to ensure peak nutrition and freshness." },
                { icon: Truck, step: "4", title: "Fast Delivery", desc: "Cold-chain delivery to your door — produce arrives as fresh as the morning harvest." },
              ].map(({ icon: Icon, step, title, desc }) => (
                <div key={step} className="relative flex flex-col items-center text-center">
                  <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-[#eff5ee]">
                    <Icon className="size-7 text-[#23403d]" aria-hidden />
                  </div>
                  <span className="absolute -top-1 -right-1 flex size-6 items-center justify-center rounded-full bg-[#ec6e55] text-xs font-bold text-white">
                    {step}
                  </span>
                  <h3 className="mb-2 font-heading text-sm font-bold text-[#23403d] sm:text-base">
                    {title}
                  </h3>
                  <p className="text-xs leading-relaxed text-[#767676] sm:text-sm">{desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Delivery areas */}
          <div className="rounded-[20px] bg-[#23403d] p-6 shadow-sm sm:p-8 lg:p-12 text-center">
            <Truck className="mx-auto mb-4 size-10 text-white/70" aria-hidden />
            <h2 className="mb-3 font-heading text-2xl font-bold text-white sm:text-3xl">
              Delivery areas
            </h2>
            <p className="mx-auto mb-6 max-w-lg text-sm leading-relaxed text-white/75">
              We currently deliver across Hyderabad and the surrounding districts of Telangana.
              Enter your pincode at checkout to check serviceability — we are expanding regularly.
            </p>
            <Link
              href="/products"
              className="inline-flex h-12 items-center justify-center rounded-full bg-[#ec6e55] px-8 text-sm font-bold text-white transition-transform hover:-translate-y-1 hover:bg-white hover:text-[#23403d] hover:shadow-lg"
            >
              Shop Now
            </Link>
          </div>

        </div>
      </section>
    </div>
  );
}
