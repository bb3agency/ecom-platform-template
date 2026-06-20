import { Sprout, FlaskConical, Package, Truck, type LucideIcon } from "lucide-react";

interface Step {
  icon: LucideIcon;
  step: string;
  title: string;
  description: string;
}

const STEPS: Step[] = [
  {
    icon: Sprout,
    step: "Step 01",
    title: "Grown by partner farmers",
    description:
      "120+ small farms across Telangana grow with native seeds, cow-based manure, and seasonal rotation. No synthetic anything.",
  },
  {
    icon: FlaskConical,
    step: "Step 02",
    title: "Tested in certified labs",
    description:
      "Every harvest batch is screened for 300+ pesticide residues by NABL-accredited labs. We publish the reports if asked.",
  },
  {
    icon: Package,
    step: "Step 03",
    title: "Hand-packed same day",
    description:
      "Produce is sorted, packed in food-grade boxes, and routed within hours of arriving at our Hyderabad facility.",
  },
];

function buildDeliveryStep(isCodEnabled: boolean): Step {
  return {
    icon: Truck,
    step: "Step 04",
    title: "Delivered within 48 hours",
    description: isCodEnabled
      ? "Cold-chain logistics across major cities. COD available where supported."
      : "Cold-chain logistics across major cities. Prepaid checkout available everywhere we ship.",
  };
}

interface FarmProcessProps {
  isCodEnabled?: boolean;
}

export function FarmProcess({ isCodEnabled = false }: FarmProcessProps) {
  const steps = [...STEPS, buildDeliveryStep(isCodEnabled)];
  return (
    <section className="relative overflow-hidden bg-[#23403d] text-white">
      {/* Decorative pattern */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 top-20 size-[420px] rounded-full bg-[#ec6e55] opacity-10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 bottom-0 size-[480px] rounded-full bg-[#dbe8d8] opacity-10 blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-[1440px] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-28">
        <div className="mx-auto mb-12 max-w-3xl text-center lg:mb-16">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white backdrop-blur-sm">
            <span className="size-1.5 rounded-full bg-[#ec6e55]" aria-hidden />
            How it works
          </span>
          <h2 className="mt-4 font-heading text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
            From the soil to your kitchen <br className="hidden sm:block" />
            in four traceable steps.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-white/75">
            Most groceries pass through five middlemen before reaching you. We
            cut it down to one — us — and document everything in between.
          </p>
        </div>

        <div className="relative">
          {/* Connecting line (desktop) */}
          <div
            aria-hidden
            className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-white/30 to-transparent lg:block"
          />

          <div className="grid gap-6 sm:gap-8 md:grid-cols-2 lg:grid-cols-4">
            {steps.map(({ icon: Icon, step, title, description }) => (
              <div key={step} className="relative">
                {/* Step number badge */}
                <div className="relative z-10 mb-6 flex size-14 items-center justify-center rounded-2xl bg-[#ec6e55] text-white shadow-lg shadow-[#ec6e55]/30">
                  <Icon className="size-6" aria-hidden />
                </div>

                <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#ffd0c2]">
                  {step}
                </p>
                <h3 className="mt-2 font-heading text-xl font-bold leading-tight text-white">
                  {title}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-white/75">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
