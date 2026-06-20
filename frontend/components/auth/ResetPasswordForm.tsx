"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { resetPassword } from "@/lib/auth-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { useAuthStore } from "@/stores/auth";
import { resetPasswordInputSchema } from "@/lib/validators";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";

type FormValues = z.infer<typeof resetPasswordInputSchema>;

interface ResetPasswordFormProps {
  token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter();
  const clearSession = useAuthStore((s) => s.clearSession);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(resetPasswordInputSchema),
    defaultValues: { token, password: "", confirmPassword: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    try {
      setError(null);
      const result = await resetPassword(values);
      setSuccessMessage(result.message);
      clearSession();
      setTimeout(() => {
        router.push("/login?reset=success");
      }, 2000);
    } catch (err) {
      setSuccessMessage(null);
      setError(getApiErrorMessage(err));
    }
  });

  return (
    <form onSubmit={submit} className="grid gap-4">
      <input type="hidden" {...form.register("token")} />

      <div className="grid gap-1">
        <label htmlFor="password" className="text-sm font-medium">
          New password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm"
          {...form.register("password")}
        />
        <p className="text-xs text-destructive">
          {form.formState.errors.password?.message}
        </p>
      </div>

      <div className="grid gap-1">
        <label htmlFor="confirmPassword" className="text-sm font-medium">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm"
          {...form.register("confirmPassword")}
        />
        <p className="text-xs text-destructive">
          {form.formState.errors.confirmPassword?.message}
        </p>
      </div>

      <AuthErrorBanner message={error} />

      {successMessage ? (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
          {successMessage}
        </p>
      ) : null}

      <button
        type="submit"
        className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
        disabled={form.formState.isSubmitting}
      >
        {form.formState.isSubmitting ? "Resetting..." : "Reset password"}
      </button>
    </form>
  );
}
