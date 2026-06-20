import { Mail, Sparkles } from "lucide-react";
import { NewsletterForm } from "@/components/shared/NewsletterForm";

export function NewsletterCTA() {
  return (
    <section className="bg-white">
      <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-4 sm:px-6 sm:pb-20 lg:px-8 lg:pb-24">
        <div className="relative overflow-hidden rounded-[32px] bg-[#23403d] px-6 py-12 text-white sm:px-10 sm:py-16 lg:px-16 lg:py-20">
          {/* Decorative blurs */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-32 -top-20 size-[420px] rounded-full bg-[#ec6e55] opacity-20 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -left-40 bottom-0 size-[400px] rounded-full bg-[#dbe8d8] opacity-15 blur-3xl"
          />

          <div className="relative grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
            <div className="lg:col-span-7">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-white backdrop-blur-sm">
                <Sparkles className="size-3 text-[#ffd0c2]" aria-hidden />
                Get 20% off your first order
              </span>

              <h2 className="mt-4 font-heading text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
                Seasonal recipes,
                <br />
                farm updates, and one good coupon.
              </h2>

              <p className="mt-4 max-w-xl text-base leading-relaxed text-white/80">
                Join 10,000+ families getting our weekly note — what&apos;s in
                season, what&apos;s arrived from the farms, and how to cook with
                it. No spam, ever. Unsubscribe in one click.
              </p>
            </div>

            <div className="lg:col-span-5">
              <div className="rounded-3xl bg-white p-6 shadow-2xl sm:p-7">
                <div className="mb-5 flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-[#dbe8d8] text-[#23403d]">
                    <Mail className="size-5" />
                  </div>
                  <div>
                    <p className="font-heading text-base font-bold text-[#23403d]">
                      Join the weekly newsletter
                    </p>
                    <p className="text-xs text-[#767676]">
                      We email Saturday mornings
                    </p>
                  </div>
                </div>
                <NewsletterForm />
                <p className="mt-3 text-[11px] text-[#767676]">
                  By subscribing you agree to our{" "}
                  <a href="/privacy" className="underline hover:text-[#23403d]">
                    privacy policy
                  </a>
                  .
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
