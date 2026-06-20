"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { requestPasswordReset } from "@/lib/auth-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { forgotPasswordInputSchema } from "@/lib/validators";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { TurnstileChallenge } from "@/components/auth/TurnstileChallenge";
import { useAuthTurnstile } from "@/hooks/use-auth-turnstile";

type FormValues = z.infer<typeof forgotPasswordInputSchema>;

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const {
    required: turnstileRequired,
    ready: turnstileReady,
    turnstileField,
    onTurnstileTokenChange,
    turnstileLoadError,
    setTurnstileLoadError,
  } = useAuthTurnstile();
  const form = useForm<FormValues>({
    resolver: zodResolver(forgotPasswordInputSchema),
    defaultValues: { email: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    if (turnstileRequired && !turnstileReady) {
      setError("Complete the security check below, then try again.");
      return;
    }
    try {
      setError(null);
      const result = await requestPasswordReset({ ...values, ...turnstileField });
      setSuccessMessage(result.message);
    } catch (err) {
      setSuccessMessage(null);
      setError(getApiErrorMessage(err));
    }
  });

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1">
        <label htmlFor="email" className="text-sm font-medium">
          Account email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm"
          {...form.register("email")}
        />
        <p className="text-xs text-destructive">
          {form.formState.errors.email?.message}
        </p>
      </div>

      <TurnstileChallenge
        onTokenChange={onTurnstileTokenChange}
        onLoadError={setTurnstileLoadError}
      />
      {turnstileLoadError ? (
        <p className="text-xs text-destructive" role="alert">
          {turnstileLoadError}
        </p>
      ) : null}

      <AuthErrorBanner message={error} />

      {successMessage ? (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
          {successMessage}
        </p>
      ) : null}

      <button
        type="submit"
        className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
        disabled={form.formState.isSubmitting || (turnstileRequired && !turnstileReady)}
      >
        {form.formState.isSubmitting ? "Submitting..." : "Send reset link"}
      </button>
    </form>
  );
}
