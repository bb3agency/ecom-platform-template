"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  Tag,
  Percent,
  Banknote,
  Truck,
  Calendar,
  Users,
  ToggleLeft,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import type {
  AdminCouponListItem,
  AdminCreateCouponInput,
  AdminUpdateCouponInput,
} from "@/lib/admin-api";
import { createIdempotencyKey } from "@/lib/idempotency";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

function toLocalDatetimeValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalDatetimeValue(value: string): string {
  return new Date(value).toISOString();
}

/** Parse rupees string → paise integer */
function rupeesToPaise(val: string): number {
  const n = parseFloat(val.replace(/,/g, ""));
  return Number.isNaN(n) ? 0 : Math.round(n * 100);
}

/** Paise → display rupees string (no symbol) */
function paiseToRupees(paise: number): string {
  if (!paise) return "";
  return (paise / 100).toFixed(paise % 100 === 0 ? 0 : 2);
}

// ── Sub-components ───────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, hint, required, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1 text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      )}
      {error && (
        <p className="flex items-center gap-1 text-[11px] text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

const inputCls = (hasError?: boolean) =>
  cn(
    "h-9 w-full rounded-lg border bg-background px-3 text-sm transition-colors",
    "focus:outline-none focus:ring-2 focus:ring-offset-0",
    hasError
      ? "border-destructive focus:ring-destructive/20"
      : "border-input focus:border-ring focus:ring-ring/40",
  );

// ── Type Option Cards ────────────────────────────────────────────────────────

interface TypeCardProps {
  active: boolean;
  icon: React.ElementType;
  label: string;
  desc: string;
  onClick: () => void;
}

function TypeCard({ active, icon: Icon, label, desc, onClick }: TypeCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-col items-start gap-1.5 rounded-xl border-2 p-2.5 text-left transition-all sm:p-3",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-md"
          : "border-border bg-card text-foreground hover:border-ring",
      )}
    >
      <Icon className={cn("h-5 w-5", active ? "text-primary-foreground" : "text-muted-foreground")} />
      <span className="text-xs font-semibold leading-none">{label}</span>
      <span className={cn("text-[10px] leading-tight", active ? "text-primary-foreground/70" : "text-muted-foreground")}>
        {desc}
      </span>
    </button>
  );
}

// ── Main Form ────────────────────────────────────────────────────────────────

export interface AdminCouponFormProps {
  coupon?: AdminCouponListItem | null;
  open: boolean;
  onSaved: () => void;
  onClose: () => void;
}

export function AdminCouponForm({
  coupon,
  open,
  onSaved,
  onClose,
}: AdminCouponFormProps) {
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.couponsWrite);
  const isEdit = Boolean(coupon);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [code, setCode] = useState("");
  const [type, setType] = useState<AdminCreateCouponInput["type"]>("PERCENTAGE_OFF");
  const [value, setValue] = useState("");          // % or ₹ depending on type
  const [minOrderRupees, setMinOrderRupees] = useState(""); // displayed as ₹
  const [maxUsesTotal, setMaxUsesTotal] = useState("");
  const [maxUsesPerUser, setMaxUsesPerUser] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Populate on edit
  useEffect(() => {
    if (!open) return;
    setSaved(false);
    setErrors({});
    setSubmitError(null);
    if (coupon) {
      setCode(coupon.code);
      setType(coupon.type as AdminCreateCouponInput["type"]);
      setValue(
        coupon.type === "FLAT_AMOUNT_OFF"
          ? paiseToRupees(coupon.value)
          : String(coupon.value),
      );
      setMinOrderRupees(paiseToRupees(coupon.minOrderPaise));
      setMaxUsesTotal(coupon.maxUsesTotal ? String(coupon.maxUsesTotal) : "");
      setMaxUsesPerUser(coupon.maxUsesPerUser ? String(coupon.maxUsesPerUser) : "");
      setValidFrom(toLocalDatetimeValue(coupon.validFrom));
      setValidUntil(toLocalDatetimeValue(coupon.validUntil));
      setIsActive(coupon.isActive);
    } else {
      setCode("");
      setType("PERCENTAGE_OFF");
      setValue("");
      setMinOrderRupees("");
      setMaxUsesTotal("");
      setMaxUsesPerUser("");
      setValidFrom(toLocalDatetimeValue(new Date().toISOString()));
      setValidUntil("");
      setIsActive(true);
    }
    setTimeout(() => firstInputRef.current?.focus(), 100);
  }, [open, coupon]);

  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!canWrite || !open) return null;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!code.trim()) next.code = "Coupon code is required";
    else if (code.trim().length < 3) next.code = "Code must be at least 3 characters";
    if (type !== "FREE_SHIPPING") {
      if (!value.trim()) {
        next.value = "Discount value is required";
      } else {
        const num = parseFloat(value);
        if (Number.isNaN(num) || num <= 0) next.value = "Enter a valid positive number";
        if (type === "PERCENTAGE_OFF" && num > 100) next.value = "Percentage cannot exceed 100%";
      }
    }
    if (!validFrom.trim()) next.validFrom = "Start date is required";
    if (validUntil && validFrom && new Date(validUntil) <= new Date(validFrom)) {
      next.validUntil = "End date must be after start date";
    }
    if (maxUsesTotal.trim() && (isNaN(Number(maxUsesTotal)) || Number(maxUsesTotal) < 1)) {
      next.maxUsesTotal = "Enter a valid number ≥ 1";
    }
    if (maxUsesPerUser.trim() && (isNaN(Number(maxUsesPerUser)) || Number(maxUsesPerUser) < 1)) {
      next.maxUsesPerUser = "Enter a valid number ≥ 1";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit() {
    if (!validate()) return;
    setSaving(true);
    setSubmitError(null);

    // Compute value in backend units
    const numericValue =
      type === "FREE_SHIPPING"
        ? 0
        : type === "FLAT_AMOUNT_OFF"
          ? rupeesToPaise(value)
          : Number(value);

    const minOrderPaise = minOrderRupees.trim() ? rupeesToPaise(minOrderRupees) : 0;

    try {
      if (isEdit && coupon) {
        const payload: AdminUpdateCouponInput = {
          code: code.trim().toUpperCase(),
          type,
          value: numericValue,
          minOrderPaise,
          maxUsesTotal: maxUsesTotal.trim() ? Number(maxUsesTotal) : undefined,
          maxUsesPerUser: maxUsesPerUser.trim() ? Number(maxUsesPerUser) : null,
          validFrom: validFrom ? fromLocalDatetimeValue(validFrom) : undefined,
          validUntil: validUntil ? fromLocalDatetimeValue(validUntil) : null,
          isActive,
        };
        await api(`/admin/coupons/${coupon.id}`, {
          method: "PATCH",
          idempotencyKey: createIdempotencyKey(),
          body: JSON.stringify(payload),
        });
      } else {
        const payload: AdminCreateCouponInput = {
          code: code.trim().toUpperCase(),
          type,
          value: numericValue,
          validFrom: fromLocalDatetimeValue(validFrom),
          minOrderPaise,
          isActive,
          ...(maxUsesTotal.trim() ? { maxUsesTotal: Number(maxUsesTotal) } : {}),
          ...(maxUsesPerUser.trim() ? { maxUsesPerUser: Number(maxUsesPerUser) } : {}),
          ...(validUntil ? { validUntil: fromLocalDatetimeValue(validUntil) } : {}),
        };
        await api("/admin/coupons", {
          method: "POST",
          idempotencyKey: createIdempotencyKey(),
          body: JSON.stringify(payload),
        });
      }
      setSaved(true);
      setTimeout(() => {
        onSaved();
      }, 800);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "An unexpected error occurred. Please try again.";
      setSubmitError(msg);
    } finally {
      setSaving(false);
    }
  }

  const valuePlaceholder =
    type === "PERCENTAGE_OFF" ? "e.g. 20" : type === "FLAT_AMOUNT_OFF" ? "e.g. 100" : "";
  const valueLabel =
    type === "PERCENTAGE_OFF"
      ? "Discount Percentage"
      : type === "FLAT_AMOUNT_OFF"
        ? "Discount Amount (₹)"
        : "Discount Value";
  const valueHint =
    type === "PERCENTAGE_OFF"
      ? "Enter a number between 1 and 100"
      : type === "FLAT_AMOUNT_OFF"
        ? "Enter amount in rupees — will be converted to paise"
        : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer — slides from right on desktop, bottom sheet on mobile */}
      <aside
        className={cn(
          "fixed z-50 flex flex-col bg-card shadow-2xl",
          // Mobile: full-width bottom sheet
          "inset-x-0 bottom-0 max-h-[92vh] rounded-t-2xl",
          // Desktop: right side drawer
          "sm:inset-x-auto sm:right-0 sm:top-0 sm:bottom-0 sm:w-[480px] sm:max-h-full sm:rounded-none sm:rounded-l-2xl",
        )}
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit coupon ${coupon?.code}` : "Create coupon"}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-foreground">
              {isEdit ? `Edit ${coupon?.code}` : "Create Coupon"}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {isEdit
                ? "Update the coupon settings below"
                : "Set up a new discount code for customers"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* ── Submit error ── */}
          {submitError && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-sm text-destructive">{submitError}</p>
            </div>
          )}

          {/* ── Success flash ── */}
          {saved && (
            <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                Coupon {isEdit ? "updated" : "created"} successfully!
              </p>
            </div>
          )}

          <div className="flex flex-col gap-6">
            {/* ── Section 1: Code & Type ── */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Code & Type
                </h3>
              </div>
              <div className="flex flex-col gap-4">
                <Field label="Coupon Code" required error={errors.code}
                  hint="Customers enter this code at checkout — will be uppercased automatically">
                  <input
                    ref={firstInputRef}
                    className={cn(inputCls(Boolean(errors.code)), "font-mono tracking-widest uppercase placeholder:normal-case placeholder:tracking-normal")}
                    placeholder="e.g. SUMMER20"
                    value={code}
                    maxLength={50}
                    onChange={(e) => {
                      setCode(e.target.value.toUpperCase());
                      if (errors.code) setErrors((p) => ({ ...p, code: "" }));
                    }}
                  />
                </Field>

                <Field label="Discount Type" required>
                  <div className="grid grid-cols-3 gap-2">
                    <TypeCard
                      active={type === "PERCENTAGE_OFF"}
                      icon={Percent}
                      label="Percentage"
                      desc="e.g. 20% off"
                      onClick={() => { setType("PERCENTAGE_OFF"); setValue(""); }}
                    />
                    <TypeCard
                      active={type === "FLAT_AMOUNT_OFF"}
                      icon={Banknote}
                      label="Flat Amount"
                      desc="e.g. ₹100 off"
                      onClick={() => { setType("FLAT_AMOUNT_OFF"); setValue(""); }}
                    />
                    <TypeCard
                      active={type === "FREE_SHIPPING"}
                      icon={Truck}
                      label="Free Ship"
                      desc="Waive shipping"
                      onClick={() => { setType("FREE_SHIPPING"); setValue("0"); }}
                    />
                  </div>
                </Field>
              </div>
            </section>

            {/* ── Section 2: Value & Limits ── */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Percent className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Value & Limits
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {type !== "FREE_SHIPPING" && (
                  <div className="col-span-2">
                    <Field label={valueLabel} required error={errors.value} hint={valueHint ?? undefined}>
                      <div className="relative">
                        <span className="absolute inset-y-0 left-3 flex items-center text-sm font-medium text-muted-foreground pointer-events-none">
                          {type === "PERCENTAGE_OFF" ? "%" : "₹"}
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={type === "PERCENTAGE_OFF" ? 100 : undefined}
                          step={type === "FLAT_AMOUNT_OFF" ? 0.01 : 1}
                          className={cn(inputCls(Boolean(errors.value)), "pl-8")}
                          placeholder={valuePlaceholder}
                          value={value}
                          onChange={(e) => {
                            setValue(e.target.value);
                            if (errors.value) setErrors((p) => ({ ...p, value: "" }));
                          }}
                        />
                      </div>
                    </Field>
                  </div>
                )}

                <Field label="Min Order Amount (₹)" hint="Leave blank for no minimum">
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3 flex items-center text-sm font-medium text-muted-foreground pointer-events-none">₹</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      className={cn(inputCls(), "pl-8")}
                      placeholder="0"
                      value={minOrderRupees}
                      onChange={(e) => setMinOrderRupees(e.target.value)}
                    />
                  </div>
                </Field>

                <Field label="Max Uses Total" hint="Leave blank for unlimited" error={errors.maxUsesTotal}>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className={cn(inputCls(Boolean(errors.maxUsesTotal)), "pl-8")}
                      placeholder="∞"
                      value={maxUsesTotal}
                      onChange={(e) => {
                        setMaxUsesTotal(e.target.value);
                        if (errors.maxUsesTotal) setErrors((p) => ({ ...p, maxUsesTotal: "" }));
                      }}
                    />
                  </div>
                </Field>

                <Field label="Max Uses Per User" hint="Leave blank for unlimited" error={errors.maxUsesPerUser}>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className={cn(inputCls(Boolean(errors.maxUsesPerUser)))}
                    placeholder="∞"
                    value={maxUsesPerUser}
                    onChange={(e) => {
                      setMaxUsesPerUser(e.target.value);
                      if (errors.maxUsesPerUser) setErrors((p) => ({ ...p, maxUsesPerUser: "" }));
                    }}
                  />
                </Field>
              </div>
            </section>

            {/* ── Section 3: Validity ── */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Validity Period
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Start Date & Time" required error={errors.validFrom}>
                  <input
                    type="datetime-local"
                    className={inputCls(Boolean(errors.validFrom))}
                    value={validFrom}
                    onChange={(e) => {
                      setValidFrom(e.target.value);
                      if (errors.validFrom) setErrors((p) => ({ ...p, validFrom: "" }));
                    }}
                  />
                </Field>
                <Field label="End Date & Time" hint="Leave blank for no expiry" error={errors.validUntil}>
                  <input
                    type="datetime-local"
                    className={inputCls(Boolean(errors.validUntil))}
                    value={validUntil}
                    onChange={(e) => {
                      setValidUntil(e.target.value);
                      if (errors.validUntil) setErrors((p) => ({ ...p, validUntil: "" }));
                    }}
                  />
                </Field>
              </div>
            </section>

            {/* ── Section 4: Status ── */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsActive((v) => !v)}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border-2 px-4 py-3 transition-all",
                  isActive
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-border bg-card",
                )}
              >
                <div className="flex flex-col items-start gap-0.5">
                  <span className={cn("text-sm font-semibold", isActive ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                    {isActive ? "Active" : "Paused"}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {isActive
                      ? "Coupon is live and can be used by customers"
                      : "Coupon is paused — customers cannot use it"}
                  </span>
                </div>
                <div className={cn(
                  "relative h-6 w-11 rounded-full transition-colors",
                  isActive ? "bg-emerald-500" : "bg-muted",
                )}>
                  <div className={cn(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform",
                    isActive ? "translate-x-5" : "translate-x-0.5",
                  )} />
                </div>
              </button>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border/40 px-5 py-4">
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="lg"
              className={cn(
                "flex-1 font-semibold",
                saved && "bg-emerald-600 text-white hover:bg-emerald-600",
              )}
              loading={saving}
              disabled={saved}
              onClick={() => void onSubmit()}
            >
              {saving ? (
                "Saving…"
              ) : saved ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Saved!
                </>
              ) : isEdit ? (
                "Update Coupon"
              ) : (
                "Create Coupon"
              )}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
