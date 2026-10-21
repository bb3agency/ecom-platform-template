import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

interface OpsPublicLayoutProps {
  title: string;
  description: ReactNode;
  children: ReactNode;
}

/**
 * Sign-in and invite setup. Deliberately bare: no console navigation exists
 * before an ops session does.
 */
export function OpsPublicLayout({ title, description, children }: OpsPublicLayoutProps) {
  return (
    <div className="console-theme ops-console flex min-h-dvh w-full flex-col bg-background text-foreground">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:py-16">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <div className="flex flex-col gap-4">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground" aria-hidden>
              <ShieldCheck className="size-5" />
            </span>
            <div className="flex flex-col gap-1.5">
              <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h1>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 sm:p-6">{children}</div>
          <p className="text-center text-sm text-muted-foreground">
            Not an operator?{" "}
            <Link href="/" className="font-medium text-foreground underline-offset-4 hover:underline">
              Go to the store
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
