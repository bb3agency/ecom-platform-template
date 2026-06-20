"use client";

interface AuthErrorBannerProps {
  message: string | null;
}

export function AuthErrorBanner({ message }: AuthErrorBannerProps) {
  if (!message) {
    return null;
  }

  return (
    <p
      className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      role="alert"
      aria-live="assertive"
    >
      {message}
    </p>
  );
}
