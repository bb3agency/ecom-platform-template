import Link from "next/link";

export default function AdminQueuesDeprecatedPage() {
  return (
    <section className="rounded-lg border border-border p-6 text-sm">
      <h2 className="font-heading text-xl font-semibold">Queue monitor moved</h2>
      <p className="mt-2 text-muted-foreground">
        Bull Board and DLQ summary now live under the ops control plane (`ops:read`). Merchant
        admin no longer exposes `queues:inspect`.
      </p>
      <Link href="/ops/queues" className="mt-4 inline-block font-medium text-primary underline-offset-4 hover:underline">
        Open /ops/queues
      </Link>
    </section>
  );
}
