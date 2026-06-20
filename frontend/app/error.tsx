"use client";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorPageProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-24">
      <h1 className="font-heading text-2xl font-semibold">
        Something went wrong
      </h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        {error.message || "An unexpected error occurred."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        aria-label="Try again"
      >
        Try again
      </button>
    </div>
  );
}
