"use client";

import { useState } from "react";
import { CheckCircle } from "lucide-react";

export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email) {
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm font-semibold text-primary">
        <CheckCircle className="size-5 text-accent" aria-hidden />
        You&apos;re subscribed! Check your inbox.
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:justify-center"
      aria-label="Newsletter signup"
      onSubmit={handleSubmit}
    >
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        className="h-11 flex-1 rounded-full border border-border bg-card px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 sm:max-w-xs"
        aria-label="Email address"
      />
      <button
        type="submit"
        className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground transition-colors hover:bg-accent"
      >
        Subscribe
      </button>
    </form>
  );
}
