import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-6 rounded-lg border border-border p-5 sm:p-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Forgot password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We will send password reset instructions to your email.
        </p>
      </div>

      <ForgotPasswordForm />

      <Link
        href="/login"
        className="text-center text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Back to sign in
      </Link>
    </div>
  );
}
