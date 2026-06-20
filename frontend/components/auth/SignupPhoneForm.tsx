"use client";

import { useState, useEffect, useCallback } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { RefreshCw } from "lucide-react";
import { getApiErrorMessage } from "@/lib/error-messages";
import { sendOtp, verifyOtpAndSignup } from "@/lib/auth-api";
import { signupPhoneInputSchema } from "@/lib/validators";
import { AuthErrorBanner } from "@/components/auth/AuthErrorBanner";
import { TurnstileChallenge } from "@/components/auth/TurnstileChallenge";
import { useAuthTurnstile } from "@/hooks/use-auth-turnstile";
import type { AuthSession } from "@/types/user";

// Mobile signup OTPs are always sent via WhatsApp.
const SIGNUP_OTP_CHANNEL = "whatsapp" as const;

const OTP_RESEND_COOLDOWN = 60;

type FormValues = z.infer<typeof signupPhoneInputSchema>;

interface SignupPhoneFormProps {
  onSuccess: (session: AuthSession) => Promise<void> | void;
}

export function SignupPhoneForm({ onSuccess }: SignupPhoneFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [otpInfo, setOtpInfo] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);

  const {
    required: turnstileRequired,
    ready: turnstileReady,
    widgetKey,
    turnstileField,
    onTurnstileTokenChange,
    bumpTurnstileWidget,
    turnstileLoadError,
    setTurnstileLoadError,
  } = useAuthTurnstile();

  // Countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  const form = useForm<FormValues>({
    resolver: zodResolver(signupPhoneInputSchema),
    defaultValues: { phone: "", otp: "", firstName: "", lastName: "", email: "" },
  });

  const doSendOtp = useCallback(async () => {
    const phone = form.getValues("phone");
    // Signup OTPs are always sent via WhatsApp.
    const result = await sendOtp({
      phone,
      channel: SIGNUP_OTP_CHANNEL,
      ...turnstileField,
    });
    return result;
  }, [form, turnstileField]);

  const send = async () => {
    if (turnstileRequired && !turnstileReady) {
      setError("Complete the security check below before requesting an OTP.");
      return;
    }
    const isValid = await form.trigger(["phone"]);
    if (!isValid) return;

    try {
      setError(null);
      setOtpInfo("Sending OTP…");
      const result = await doSendOtp();
      setOtpInfo(result.message);
      setOtpSent(true);
      setResendCooldown(OTP_RESEND_COOLDOWN);
    } catch (err) {
      setOtpInfo(null);
      setError(getApiErrorMessage(err));
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setOtpInfo(null);
    bumpTurnstileWidget();
    await new Promise((r) => setTimeout(r, 300));
    try {
      const result = await doSendOtp();
      setOtpInfo(`OTP resent. ${result.message}`);
      setResendCooldown(OTP_RESEND_COOLDOWN);
      form.resetField("otp");
    } catch (err) {
      const raw = getApiErrorMessage(err);
      const match = /retry after (\d+)/i.exec(raw);
      if (match) setResendCooldown(Number(match[1]));
      setError(raw);
    } finally {
      setResending(false);
    }
  };

  const submit = form.handleSubmit(async (values) => {
    try {
      setError(null);
      const session = await verifyOtpAndSignup({
        phone: values.phone,
        otp: values.otp,
        firstName: values.firstName || undefined,
        lastName: values.lastName || undefined,
        email: values.email || undefined,
      });
      await onSuccess(session);
    } catch (err) {
      const raw = getApiErrorMessage(err);
      if (raw.toLowerCase().includes("email or password")) {
        setError("Invalid or expired OTP. Please check the code and try again.");
      } else {
        setError(raw);
      }
    }
  });

  return (
    <form onSubmit={submit} className="grid gap-5">
      <p className="text-sm font-medium text-[#767676]">
        Enter your mobile number. A one-time code will be sent via WhatsApp.
      </p>

      <div className="grid gap-1.5">
        <label htmlFor="phone" className="text-sm font-bold text-[#23403d]">
          Mobile Number <span className="font-normal text-red-500">*</span>
        </label>
        <input
          id="phone"
          type="tel"
          autoComplete="tel"
          placeholder="9876543210"
          className="h-12 w-full rounded-full border border-[#efe8e4] bg-[#faf3ef] px-4 text-sm font-medium text-[#23403d] placeholder:text-[#767676] focus:border-[#23403d] focus:outline-none focus:ring-1 focus:ring-[#23403d]"
          {...form.register("phone")}
        />
        {form.formState.errors.phone && (
          <p className="text-xs font-bold text-red-500">{form.formState.errors.phone.message}</p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor="otp-firstName" className="text-sm font-bold text-[#23403d]">
            First Name <span className="font-normal text-[#767676]">(optional)</span>
          </label>
          <input
            id="otp-firstName"
            type="text"
            placeholder="Ravi"
            autoComplete="given-name"
            className="h-12 w-full rounded-full border border-[#efe8e4] bg-[#faf3ef] px-4 text-sm font-medium text-[#23403d] placeholder:text-[#767676] focus:border-[#23403d] focus:outline-none focus:ring-1 focus:ring-[#23403d]"
            {...form.register("firstName")}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="otp-lastName" className="text-sm font-bold text-[#23403d]">
            Last Name <span className="font-normal text-[#767676]">(optional)</span>
          </label>
          <input
            id="otp-lastName"
            type="text"
            placeholder="Kumar"
            autoComplete="family-name"
            className="h-12 w-full rounded-full border border-[#efe8e4] bg-[#faf3ef] px-4 text-sm font-medium text-[#23403d] placeholder:text-[#767676] focus:border-[#23403d] focus:outline-none focus:ring-1 focus:ring-[#23403d]"
            {...form.register("lastName")}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="signup-email" className="text-sm font-bold text-[#23403d]">
          Email{" "}
          <span className="font-normal text-[#767676]">(optional)</span>
        </label>
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          className="h-12 w-full rounded-full border border-[#efe8e4] bg-[#faf3ef] px-4 text-sm font-medium text-[#23403d] placeholder:text-[#767676] focus:border-[#23403d] focus:outline-none focus:ring-1 focus:ring-[#23403d]"
          {...form.register("email")}
        />
        {form.formState.errors.email && (
          <p className="text-xs font-bold text-red-500">{form.formState.errors.email.message}</p>
        )}
      </div>

      {/* Turnstile for send-otp call */}
      <TurnstileChallenge
        key={widgetKey}
        onTokenChange={onTurnstileTokenChange}
        onLoadError={setTurnstileLoadError}
      />
      {turnstileLoadError && (
        <p className="text-xs font-bold text-red-500" role="alert">{turnstileLoadError}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="h-12 flex-1 rounded-full border-2 border-[#efe8e4] bg-white px-6 text-sm font-bold text-[#23403d] transition-colors hover:border-[#23403d] disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => void send()}
          disabled={
            form.formState.isSubmitting ||
            (turnstileRequired && !turnstileReady)
          }
        >
          Send OTP
        </button>

        {otpSent && (
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={resendCooldown > 0 || resending || (turnstileRequired && !turnstileReady)}
            className="flex items-center gap-1.5 text-xs font-bold text-[#ec6e55] transition-colors hover:text-[#23403d] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="size-3" aria-hidden />
            {resending ? "Resending…" : resendCooldown > 0 ? `${resendCooldown}s` : "Resend"}
          </button>
        )}
      </div>

      {otpInfo && <p className="text-xs font-bold text-[#00aa63]">{otpInfo}</p>}

      <div className="grid gap-1.5">
        <label htmlFor="signup-otp" className="text-sm font-bold text-[#23403d]">OTP</label>
        <input
          id="signup-otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="h-12 w-full rounded-full border border-[#efe8e4] bg-[#faf3ef] px-4 text-center text-lg font-bold tracking-[0.5em] text-[#23403d] focus:border-[#23403d] focus:outline-none focus:ring-1 focus:ring-[#23403d]"
          {...form.register("otp")}
        />
        {form.formState.errors.otp && (
          <p className="text-xs font-bold text-red-500">{form.formState.errors.otp?.message}</p>
        )}
      </div>

      <AuthErrorBanner message={error} />

      <button
        type="submit"
        className="mt-2 h-12 w-full rounded-full bg-[#23403d] px-8 text-sm font-bold text-white transition-transform hover:-translate-y-1 hover:bg-[#ec6e55] hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        disabled={form.formState.isSubmitting}
      >
        {form.formState.isSubmitting ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
