"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { MapPin, Plus, Pencil, Trash2, Star, Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import {
  getMyAddresses,
  createMyAddress,
  updateMyAddress,
  deleteMyAddress,
  type UserAddress,
} from "@/lib/users-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";

const addressSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  phone: z.string().regex(/^\+?[0-9]{10,15}$/, "Enter a valid phone number"),
  line1: z.string().min(5, "Address must be at least 5 characters"),
  line2: z.string().optional(),
  city: z.string().min(2, "City is required"),
  state: z.string().min(2, "State is required"),
  pincode: z.string().regex(/^[0-9]{6}$/, "Pincode must be 6 digits"),
});

type AddressFormData = z.infer<typeof addressSchema>;

const inputClass =
  "flex h-10 w-full rounded-lg border border-[#efe8e4] bg-white px-3 py-1 text-sm text-[#23403d] transition-colors placeholder:text-[#767676]/60 focus-visible:border-[#23403d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#23403d]/15";

export default function AccountAddressesPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [addresses, setAddresses] = useState<UserAddress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const form = useForm<AddressFormData>({ resolver: zodResolver(addressSchema) });
  const errors = form.formState.errors;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!accessToken) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const data = await getMyAddresses(accessToken);
        if (!cancelled) setAddresses(data);
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const onSubmit = async (values: AddressFormData) => {
    if (!accessToken) return;
    setBusy(true);
    try {
      if (editingId) {
        const updated = await updateMyAddress(accessToken, editingId, {
          fullName: values.fullName,
          phone: values.phone,
          line1: values.line1,
          ...(values.line2?.trim() ? { line2: values.line2.trim() } : { line2: null }),
          city: values.city,
          state: values.state,
          pincode: values.pincode,
        });
        setAddresses((prev) => prev.map((a) => (a.id === editingId ? updated : a)));
        toast.success("Address updated");
      } else {
        const created = await createMyAddress(accessToken, {
          fullName: values.fullName,
          phone: values.phone,
          line1: values.line1,
          ...(values.line2?.trim() ? { line2: values.line2.trim() } : {}),
          city: values.city,
          state: values.state,
          pincode: values.pincode,
          isDefault: addresses.length === 0,
        });
        setAddresses((prev) => [...prev, created]);
        toast.success("Address added");
      }
      closeForm();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    if (!accessToken) return;
    setBusy(true);
    try {
      const updated = await updateMyAddress(accessToken, id, { isDefault: true });
      setAddresses((prev) => prev.map((a) => (a.id === id ? updated : { ...a, isDefault: false })));
      toast.success("Default address updated");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = (address: UserAddress) => {
    setEditingId(address.id);
    setShowForm(true);
    form.reset({
      fullName: address.fullName,
      phone: address.phone,
      line1: address.line1,
      line2: address.line2 ?? "",
      city: address.city,
      state: address.state,
      pincode: address.pincode,
    });
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    if (!confirm("Delete this address?")) return;
    setBusy(true);
    try {
      await deleteMyAddress(accessToken, id);
      setAddresses((prev) => prev.filter((a) => a.id !== id));
      toast.success("Address deleted");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    form.reset({ fullName: "", phone: "", line1: "", line2: "", city: "", state: "", pincode: "" });
  };

  const field = (
    name: keyof AddressFormData,
    label: string,
    options?: { span2?: boolean; maxLength?: number; inputMode?: "tel" | "numeric" },
  ) => (
    <div className={`grid gap-1.5 ${options?.span2 ? "sm:col-span-2" : ""}`}>
      <label className="text-xs font-bold text-[#23403d]" htmlFor={`addr-${name}`}>
        {label}
      </label>
      <input
        id={`addr-${name}`}
        {...form.register(name)}
        maxLength={options?.maxLength}
        inputMode={options?.inputMode}
        className={inputClass}
      />
      {errors[name] && <p className="text-xs text-destructive">{errors[name]?.message}</p>}
    </div>
  );

  return (
    <section className="flex flex-col gap-5 sm:gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-xl font-bold text-[#23403d] sm:text-2xl">
            Saved Addresses
          </h1>
          <p className="mt-1 text-sm text-[#767676]">
            Delivery addresses used at checkout. Your default is preselected.
          </p>
        </div>
        {!showForm && (
          <Button
            size="sm"
            className="gap-1.5 bg-[#23403d] hover:bg-[#1a302e]"
            disabled={busy}
            onClick={() => {
              setEditingId(null);
              form.reset({ fullName: "", phone: "", line1: "", line2: "", city: "", state: "", pincode: "" });
              setShowForm(true);
            }}
          >
            <Plus className="size-4" aria-hidden />
            Add Address
          </Button>
        )}
      </div>

      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {/* Add / edit form */}
      {showForm && (
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="grid gap-4 rounded-2xl border border-[#efe8e4] bg-[#faf3ef]/60 p-4 sm:p-5"
        >
          <h2 className="text-sm font-bold text-[#23403d]">
            {editingId ? "Edit address" : "Add a new address"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {field("fullName", "Full Name")}
            {field("phone", "Phone", { inputMode: "tel", maxLength: 16 })}
            {field("line1", "Address Line 1", { span2: true })}
            {field("line2", "Address Line 2 (optional)", { span2: true })}
            {field("city", "City")}
            {field("state", "State")}
            {field("pincode", "Pincode", { inputMode: "numeric", maxLength: 6 })}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="sm" onClick={closeForm} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="bg-[#23403d] hover:bg-[#1a302e]" disabled={busy}>
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Saving…
                </>
              ) : editingId ? (
                "Update Address"
              ) : (
                "Save Address"
              )}
            </Button>
          </div>
        </form>
      )}

      {/* Address cards */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl border border-[#efe8e4] bg-[#eff5ee]" />
          ))}
        </div>
      ) : addresses.length === 0 && !showForm ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-[#efe8e4] py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-[#eff5ee] text-[#23403d]">
            <MapPin className="size-6" aria-hidden />
          </div>
          <p className="text-sm font-medium text-[#23403d]">No saved addresses yet</p>
          <p className="max-w-xs text-xs text-[#767676]">
            Add a delivery address to speed through checkout next time.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {addresses.map((address) => (
            <article
              key={address.id}
              className={`relative flex flex-col gap-2 rounded-2xl border p-4 text-sm transition-colors ${
                address.isDefault ? "border-[#23403d]/30 bg-[#eff5ee]/50" : "border-[#efe8e4] bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold text-[#23403d]">{address.fullName}</p>
                {address.isDefault && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#23403d] px-2 py-0.5 text-[10px] font-bold text-white">
                    <Star className="size-2.5 fill-current" aria-hidden />
                    Default
                  </span>
                )}
              </div>
              <div className="text-[#767676]">
                <p>{address.line1}</p>
                {address.line2 && <p>{address.line2}</p>}
                <p>
                  {address.city}, {address.state} — {address.pincode}
                </p>
                <p className="mt-1">{address.phone}</p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-2">
                {!address.isDefault && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={busy}
                    onClick={() => void handleSetDefault(address.id)}
                  >
                    Set Default
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  disabled={busy}
                  onClick={() => handleEdit(address)}
                >
                  <Pencil className="size-3" aria-hidden />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy}
                  onClick={() => void handleDelete(address.id)}
                >
                  <Trash2 className="size-3" aria-hidden />
                  Delete
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
