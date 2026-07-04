"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { consumeAdminInvite, sendAdminSetupOtp } from "@/lib/admin-setup-api";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { isCompleteOtpCode, normalizeOtpCodeInput } from "@/lib/otp-code";
import { getAdminOtpChannelConfig } from "@/lib/admin-auth-api";
import { Eye, EyeOff, Loader2, CheckCircle2, Lock, User, Phone } from "lucide-react";

interface AdminSetupFormProps {
  token: string;
}

export function AdminSetupForm({ token }: AdminSetupFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"details" | "otp">("details");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [otpChannel, setOtpChannel] = useState<"sms" | "whatsapp" | "email">("email");
  const [loadingChannel, setLoadingChannel] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [otpRemainingSec, setOtpRemainingSec] = useState(0);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void getAdminOtpChannelConfig()
      .then((response) => {
        if (!cancelled) {
          setOtpChannel(response.channel);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOtpChannel("email");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingChannel(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startOtpCountdown = useCallback((expiryIso: string) => {
    const expiryMs = new Date(expiryIso).getTime();
    const remaining = Math.max(0, Math.ceil((expiryMs - Date.now()) / 1000));
    setOtpRemainingSec(remaining);
    const interval = window.setInterval(() => {
      setOtpRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const startResendCooldown = useCallback(() => {
    setResendCooldown(60);
    const interval = window.setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  async function requestOtp() {
    setError(null);
    setIsLoading(true);
    try {
      const response = await sendAdminSetupOtp({
        token,
        name: name.trim(),
        password,
        ...(phone.trim() ? { phone } : {}),
      });
      setStep("otp");
      setExpiresAt(response.expiresAt);
      startOtpCountdown(response.expiresAt);
      startResendCooldown();
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResendOtp() {
    if (resendCooldown > 0) return;
    setError(null);
    setIsLoading(true);
    try {
      const response = await sendAdminSetupOtp({
        token,
        name: name.trim(),
        password,
        ...(phone.trim() ? { phone } : {}),
      });
      setExpiresAt(response.expiresAt);
      startOtpCountdown(response.expiresAt);
      startResendCooldown();
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function consumeInvite() {
    setError(null);
    setIsLoading(true);
    try {
      await consumeAdminInvite({ token, otp: normalizeOtpCodeInput(otp) });
      router.replace("/admin/login");
    } catch (err) {
      setError(getApiErrorMessageWithHint(err));
    } finally {
      setIsLoading(false);
    }
  }

  const canSubmitDetails =
    !loadingChannel &&
    name.trim().length > 0 &&
    password.trim().length >= 8 &&
    (otpChannel === "email" || phone.trim().length > 0);

  return (
    <section className="mx-auto grid w-full max-w-xl gap-5 rounded-xl border border-[#efe8e4] bg-white p-6 shadow-sm">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-[#23403d]">Admin setup</h1>
        <p className="mt-1 text-sm text-[#769b97]">
          Complete your invite onboarding using OTP via{" "}
          {otpChannel === "sms" ? "SMS" : otpChannel === "whatsapp" ? "WhatsApp" : "email"}.
        </p>
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-2">
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
            step === "details"
              ? "bg-[#23403d] text-white"
              : "bg-[#23403d] text-white"
          }`}
        >
          {step === "otp" ? <CheckCircle2 className="h-4 w-4" /> : "1"}
        </div>
        <div className="h-0.5 flex-1 bg-[#efe8e4]">
          <div
            className={`h-full bg-[#23403d] transition-all ${
              step === "otp" ? "w-full" : "w-0"
            }`}
          />
        </div>
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
            step === "otp"
              ? "bg-[#23403d] text-white"
              : "border border-[#efe8e4] text-[#769b97]"
          }`}
        >
          2
        </div>
      </div>
      <div className="flex justify-between text-xs text-[#769b97]">
        <span>Account details</span>
        <span>Verify OTP</span>
      </div>

      {step === "details" ? (
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-[#23403d]">
            <span className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-[#769b97]" />
              Full name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="John Doe"
              className="h-11 rounded-lg border border-[#efe8e4] bg-[#faf3ef]/30 px-3 text-sm text-[#23403d] placeholder:text-[#769b97]/60 focus:border-[#23403d] focus:outline-none"
              required
            />
          </label>

          <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-[#23403d]">
            <span className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-[#769b97]" />
              Phone {otpChannel === "email" ? "(optional)" : "(required)"}
            </span>
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+91 98765 43210"
              className="h-11 rounded-lg border border-[#efe8e4] bg-[#faf3ef]/30 px-3 text-sm text-[#23403d] placeholder:text-[#769b97]/60 focus:border-[#23403d] focus:outline-none"
              required={otpChannel !== "email"}
            />
          </label>

          <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-[#23403d]">
            <span className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-[#769b97]" />
              Password
            </span>
            <div className="relative">
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                placeholder="Min. 8 characters"
                minLength={8}
                className="h-11 w-full rounded-lg border border-[#efe8e4] bg-[#faf3ef]/30 px-3 pr-10 text-sm text-[#23403d] placeholder:text-[#769b97]/60 focus:border-[#23403d] focus:outline-none"
                required
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#769b97] hover:text-[#23403d]"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </label>

          <button
            type="button"
            onClick={requestOtp}
            disabled={isLoading || !canSubmitDetails}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#23403d] px-4 text-sm font-medium text-white transition-colors hover:bg-[#1a3330] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending OTP…
              </>
            ) : (
              "Send OTP"
            )}
          </button>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4">
          <p className="text-sm text-[#769b97]">
            Enter the 6-digit OTP sent to{" "}
            {otpChannel === "email" ? "your email" : "your phone"}.
            {otpRemainingSec > 0 ? (
              <span className="ml-1 text-amber-600">
                Expires in {Math.floor(otpRemainingSec / 60)}:
                {(otpRemainingSec % 60).toString().padStart(2, "0")}
              </span>
            ) : expiresAt ? (
              <span className="ml-1 text-red-600">Expired</span>
            ) : null}
          </p>

          <label className="grid min-w-0 grid-cols-1 gap-1.5 text-sm font-medium text-[#23403d]">
            OTP code
            <input
              value={otp}
              onChange={(event) => setOtp(normalizeOtpCodeInput(event.target.value))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              minLength={6}
              maxLength={6}
              className="h-11 rounded-lg border border-[#efe8e4] bg-[#faf3ef]/30 px-3 text-center text-sm tracking-[0.3em] text-[#23403d] placeholder:text-[#769b97]/60 focus:border-[#23403d] focus:outline-none"
              required
            />
          </label>

          <div className="flex items-center justify-between">
            <button
              type="button"
              className="text-sm text-[#769b97] underline-offset-4 hover:underline"
              onClick={() => setStep("details")}
            >
              Back to details
            </button>
            <button
              type="button"
              disabled={resendCooldown > 0}
              onClick={() => void handleResendOtp()}
              className="text-sm text-[#23403d] underline-offset-4 hover:underline disabled:text-[#769b97] disabled:no-underline"
            >
              {resendCooldown > 0
                ? `Resend in ${resendCooldown}s`
                : "Resend OTP"}
            </button>
          </div>

          <button
            type="button"
            onClick={consumeInvite}
            disabled={isLoading || !isCompleteOtpCode(otp)}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#23403d] px-4 text-sm font-medium text-white transition-colors hover:bg-[#1a3330] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Completing setup…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Complete setup
              </>
            )}
          </button>
        </div>
      )}

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
