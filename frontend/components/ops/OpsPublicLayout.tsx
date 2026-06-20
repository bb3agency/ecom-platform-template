import type { ReactNode } from "react";
import Link from "next/link";
import { Shield } from "lucide-react";

interface OpsPublicLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function OpsPublicLayout({ title, description, children }: OpsPublicLayoutProps) {
  return (
    <div className="dark ops-console min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-2">
        <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
          <div className="relative z-10 flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Shield className="size-6" aria-hidden />
            </div>
            <div>
              <p className="font-heading text-lg font-semibold">Ops Control Plane</p>
              <p className="text-sm text-muted-foreground">Secure platform operations</p>
            </div>
          </div>
          <div className="relative z-10 grid max-w-md gap-4">
            <h1 className="font-heading text-3xl font-semibold leading-tight">
              Operate your commerce stack with confidence
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Browser-session authentication, email OTP for privileged actions, and encrypted
              configuration overlays — aligned with the Fastify ops API contract.
            </p>
            <ul className="grid gap-2 text-sm text-muted-foreground">
              <li>HttpOnly session cookies — no API keys in the browser</li>
              <li>Secondary OTP for config, load-shed, restarts, and user lifecycle</li>
              <li>Masked secrets and restart-aware config saves</li>
            </ul>
          </div>
          <p className="relative z-10 text-xs text-muted-foreground">
            Layer C · Platform operators only
          </p>
          <div
            className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-primary/10 blur-3xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-32 -left-16 size-72 rounded-full bg-chart-1/20 blur-3xl"
            aria-hidden
          />
        </div>

        <div className="flex flex-col justify-center px-6 py-12 sm:px-10 lg:px-14">
          <div className="mx-auto w-full max-w-md">
            <div className="mb-8 lg:hidden">
              <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Shield className="size-6" aria-hidden />
              </div>
            </div>
            <div className="mb-8 grid gap-2">
              <h2 className="font-heading text-2xl font-semibold tracking-tight">{title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
            </div>
            {children}
            <p className="mt-8 text-center text-sm text-muted-foreground">
              <Link href="/" className="font-medium text-primary underline-offset-4 hover:underline">
                Return to storefront
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
