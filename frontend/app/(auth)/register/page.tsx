"use client";

import Link from "next/link";
import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SignupPhoneForm } from "@/components/auth/SignupPhoneForm";
import { EmailRegisterForm } from "@/components/auth/EmailRegisterForm";
import { useAuthStore } from "@/stores/auth";
import { fetchPublicStoreConfigClient } from "@/lib/storefront-settings";
import { mergeGuestCartAfterAuth } from "@/lib/post-auth-cart-merge";
import type { AuthSession } from "@/types/user";

type RegisterMode = "email" | "otp";

function RegisterPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);
  const [mode, setMode] = useState<RegisterMode>("email");
  const [mobileOtpEnabled, setMobileOtpEnabled] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);

  const rawRedirect = searchParams.get("redirect") ?? "";
  const redirectTo = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/dashboard";

  // Fetch mobileOtpSignupEnabled from the public store config.
  // This is a lightweight ISR-cached endpoint — no auth needed.
  useEffect(() => {
    fetchPublicStoreConfigClient()
      .then((config) => {
        if (config.mobileOtpSignupEnabled) {
          setMobileOtpEnabled(true);
        }
      })
      .catch(() => {/* non-fatal — default to email-only */ })
      .finally(() => setConfigLoaded(true));
  }, []);

  const handleSuccess = async (session: AuthSession) => {
    setSession(session.accessToken, session.user);
    await mergeGuestCartAfterAuth(session.accessToken);
    router.push(redirectTo);
  };

  return (
    <div className="flex flex-col gap-6 p-5 sm:gap-8 sm:p-8 lg:p-12">
      <div className="text-center">
        <h1 className="font-heading text-2xl font-bold text-primary sm:text-3xl">
          Create Account
        </h1>
        <p className="mt-3 text-sm font-medium text-muted-foreground">
          {mobileOtpEnabled
            ? "Sign up with your email & password or with your mobile number."
            : "Sign up with your email and password to get started."}
        </p>
      </div>

      <div className="grid gap-6">
        {/* Show tabs only when mobile OTP signup is enabled by the merchant */}
        {mobileOtpEnabled && configLoaded && (
          <div
            className="flex gap-2 rounded-full border border-border bg-muted p-1.5"
            role="tablist"
            aria-label="Sign-up method"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "email"}
              className={`flex-1 h-10 rounded-full text-sm font-bold transition-colors ${
                mode === "email"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-primary"
              }`}
              onClick={() => setMode("email")}
            >
              Sign up with Email
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "otp"}
              className={`flex-1 h-10 rounded-full text-sm font-bold transition-colors ${
                mode === "otp"
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-primary"
              }`}
              onClick={() => setMode("otp")}
            >
              Sign up with Mobile
            </button>
          </div>
        )}

        {/* Render the appropriate form */}
        {(!mobileOtpEnabled || mode === "email") && (
          <EmailRegisterForm onSuccess={handleSuccess} />
        )}
        {mobileOtpEnabled && mode === "otp" && (
          <SignupPhoneForm onSuccess={handleSuccess} />
        )}
      </div>

      <div className="border-t border-border pt-6">
        <Link
          href={`/login${redirectTo !== "/dashboard" ? `?redirect=${encodeURIComponent(redirectTo)}` : ""}`}
          className="block text-center text-sm font-bold text-primary transition-colors hover:text-accent"
        >
          Already have an account? Sign in
        </Link>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-6 p-5 sm:gap-8 sm:p-8 lg:p-12">
          <p className="text-center text-sm text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <RegisterPageContent />
    </Suspense>
  );
}
