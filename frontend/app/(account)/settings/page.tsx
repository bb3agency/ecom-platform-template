"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { UserCircle, Smartphone, MapPin, ChevronRight, Loader2, ShieldCheck } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { updateMyProfile } from "@/lib/users-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
  email: z.string().email("Enter a valid email").or(z.literal("")).optional(),
});

const phoneSchema = z.object({
  phone: z.string().regex(/^\+?[0-9]{10,15}$/, "Enter a valid mobile number (10–15 digits)"),
});

type ProfileFormData = z.infer<typeof profileSchema>;
type PhoneFormData = z.infer<typeof phoneSchema>;

const inputClass =
  "flex h-10 w-full rounded-lg border border-[#efe8e4] bg-white px-3 py-1 text-sm text-[#23403d] transition-colors placeholder:text-[#767676]/60 focus-visible:border-[#23403d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#23403d]/15";

function SectionCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[#efe8e4] bg-white p-4 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eff5ee] text-[#23403d]">
          {icon}
        </div>
        <div>
          <h2 className="font-heading text-base font-bold text-[#23403d] sm:text-lg">{title}</h2>
          <p className="text-xs text-[#767676] sm:text-sm">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

export default function AccountSettingsPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const setSession = useAuthStore((s) => s.setSession);

  const [profileBusy, setProfileBusy] = useState(false);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [editingPhone, setEditingPhone] = useState(false);

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      email: user?.email ?? "",
    },
  });

  const phoneForm = useForm<PhoneFormData>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: "" },
  });

  useEffect(() => {
    profileForm.reset({
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      email: user?.email ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const onProfileSubmit = async (values: ProfileFormData) => {
    if (!accessToken) return;
    setProfileBusy(true);
    try {
      const updated = await updateMyProfile(accessToken, {
        firstName: values.firstName,
        ...(values.lastName ? { lastName: values.lastName } : {}),
        ...(values.email ? { email: values.email } : {}),
      });
      setSession(accessToken, updated);
      toast.success("Profile updated");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setProfileBusy(false);
    }
  };

  const onPhoneSubmit = async (values: PhoneFormData) => {
    if (!accessToken) return;
    setPhoneBusy(true);
    try {
      const updated = await updateMyProfile(accessToken, { phone: values.phone.trim() });
      setSession(accessToken, updated);
      toast.success(user?.phone ? "Mobile number updated" : "Mobile number added");
      setEditingPhone(false);
      phoneForm.reset({ phone: "" });
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setPhoneBusy(false);
    }
  };

  const onPhoneRemove = async () => {
    if (!accessToken) return;
    if (
      !confirm(
        "Remove your mobile number? You will no longer be able to sign in with a mobile OTP — only with your email.",
      )
    ) {
      return;
    }
    setPhoneBusy(true);
    try {
      const updated = await updateMyProfile(accessToken, { phone: null });
      setSession(accessToken, updated);
      toast.success("Mobile number removed");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setPhoneBusy(false);
    }
  };

  const profileErrors = profileForm.formState.errors;
  const phoneErrors = phoneForm.formState.errors;
  const currentPhone = user?.phone?.trim() || "";

  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      <div>
        <h1 className="font-heading text-xl font-bold text-[#23403d] sm:text-2xl">Settings</h1>
        <p className="mt-1 text-sm text-[#767676]">Manage your personal details and sign-in options.</p>
      </div>

      {/* ── Profile ─────────────────────────────────────────────────────── */}
      <SectionCard
        icon={<UserCircle className="size-5" aria-hidden />}
        title="Profile"
        description="Your name and email address."
      >
        <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label className="text-xs font-bold text-[#23403d]" htmlFor="profile-first-name">
                First Name
              </label>
              <input id="profile-first-name" {...profileForm.register("firstName")} className={inputClass} />
              {profileErrors.firstName && (
                <p className="text-xs text-destructive">{profileErrors.firstName.message}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-bold text-[#23403d]" htmlFor="profile-last-name">
                Last Name
              </label>
              <input id="profile-last-name" {...profileForm.register("lastName")} className={inputClass} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <label className="text-xs font-bold text-[#23403d]" htmlFor="profile-email">
                Email
              </label>
              <input id="profile-email" type="email" {...profileForm.register("email")} className={inputClass} />
              {profileErrors.email && (
                <p className="text-xs text-destructive">{profileErrors.email.message}</p>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" className="bg-[#23403d] hover:bg-[#1a302e]" disabled={profileBusy}>
              {profileBusy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Saving…
                </>
              ) : (
                "Save Profile"
              )}
            </Button>
          </div>
        </form>
      </SectionCard>

      {/* ── Mobile number ───────────────────────────────────────────────── */}
      <SectionCard
        icon={<Smartphone className="size-5" aria-hidden />}
        title="Mobile Number"
        description="Used for OTP sign-in and delivery updates."
      >
        {currentPhone && !editingPhone ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="size-4 shrink-0 text-[#23403d]" aria-hidden />
              <div>
                <p className="text-sm font-bold text-[#23403d]">{currentPhone}</p>
                <p className="text-xs text-[#767676]">You can sign in with an OTP sent to this number.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={phoneBusy}
                onClick={() => {
                  phoneForm.reset({ phone: currentPhone });
                  setEditingPhone(true);
                }}
              >
                Change
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={phoneBusy}
                onClick={() => void onPhoneRemove()}
              >
                {phoneBusy ? "Working…" : "Remove"}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={phoneForm.handleSubmit(onPhoneSubmit)} className="grid gap-3">
            {!currentPhone && (
              <p className="text-sm text-[#767676]">
                No mobile number on your account yet. Add one to enable OTP sign-in and receive
                delivery updates.
              </p>
            )}
            <div className="grid gap-1.5 sm:max-w-sm">
              <label className="text-xs font-bold text-[#23403d]" htmlFor="settings-phone">
                Mobile Number
              </label>
              <input
                id="settings-phone"
                type="tel"
                inputMode="tel"
                placeholder="10-digit mobile number"
                maxLength={16}
                {...phoneForm.register("phone")}
                className={inputClass}
              />
              {phoneErrors.phone && <p className="text-xs text-destructive">{phoneErrors.phone.message}</p>}
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" className="bg-[#23403d] hover:bg-[#1a302e]" disabled={phoneBusy}>
                {phoneBusy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Saving…
                  </>
                ) : currentPhone ? (
                  "Update Number"
                ) : (
                  "Add Number"
                )}
              </Button>
              {editingPhone && (
                <Button type="button" variant="outline" size="sm" disabled={phoneBusy} onClick={() => setEditingPhone(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}
      </SectionCard>

      {/* ── Addresses shortcut ──────────────────────────────────────────── */}
      <Link
        href="/addresses"
        className="group flex items-center justify-between rounded-2xl border border-[#efe8e4] bg-white p-4 transition-colors hover:border-[#23403d]/30 hover:bg-[#eff5ee]/40 sm:p-5"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eff5ee] text-[#23403d]">
            <MapPin className="size-5" aria-hidden />
          </div>
          <div>
            <p className="font-heading text-base font-bold text-[#23403d]">Saved Addresses</p>
            <p className="text-xs text-[#767676] sm:text-sm">Manage delivery addresses used at checkout.</p>
          </div>
        </div>
        <ChevronRight className="size-5 text-[#767676] transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </section>
  );
}
