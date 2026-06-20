import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = params.token ?? "";

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-border p-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Reset password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your new password below.
        </p>
      </div>

      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="text-sm text-destructive">
          Invalid or missing reset token. Please request a new password reset
          link.
        </p>
      )}

      <Link
        href="/login"
        className="text-center text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Back to sign in
      </Link>
    </div>
  );
}
