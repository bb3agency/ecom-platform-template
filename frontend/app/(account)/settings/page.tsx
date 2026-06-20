"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuthStore } from "@/stores/auth";
import {
  getMyAddresses,
  createMyAddress,
  updateMyAddress,
  deleteMyAddress,
  updateMyProfile,
  type UserAddress,
} from "@/lib/users-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { Button } from "@/components/ui/button";

const profileSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
  email: z.string().email("Enter a valid email").or(z.literal("")).optional(),
});

const addressSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  phone: z.string().min(10, "Enter a valid phone number"),
  line1: z.string().min(5, "Address must be at least 5 characters"),
  line2: z.string().optional(),
  city: z.string().min(2, "City is required"),
  state: z.string().min(2, "State is required"),
  pincode: z.string().min(6, "Pincode must be 6 digits").max(6, "Pincode must be 6 digits"),
});

type ProfileFormData = z.infer<typeof profileSchema>;
type AddressFormData = z.infer<typeof addressSchema>;

export default function AccountSettingsPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const setSession = useAuthStore((s) => s.setSession);

  const [addresses, setAddresses] = useState<UserAddress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      email: user?.email ?? "",
    },
  });

  const addressForm = useForm<AddressFormData>({
    resolver: zodResolver(addressSchema),
  });

  useEffect(() => {
    profileForm.reset({
      firstName: user?.firstName ?? "",
      lastName: user?.lastName ?? "",
      email: user?.email ?? "",
    });
  }, [user]);

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
    return () => { cancelled = true; };
  }, [accessToken]);

  const onProfileSubmit = async (values: ProfileFormData) => {
    if (!accessToken) return;
    setProfileBusy(true);
    setError(null);
    setProfileSuccess(false);
    try {
      const updated = await updateMyProfile(accessToken, {
        firstName: values.firstName,
        ...(values.lastName ? { lastName: values.lastName } : {}),
        ...(values.email ? { email: values.email } : {}),
      });
      if (accessToken) {
        setSession(accessToken, updated);
      }
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setProfileBusy(false);
    }
  };

  const onAddressSubmit = async (values: AddressFormData) => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      if (editingAddressId) {
        const updated = await updateMyAddress(accessToken, editingAddressId, {
          fullName: values.fullName,
          phone: values.phone,
          line1: values.line1,
          ...(values.line2?.trim() ? { line2: values.line2.trim() } : { line2: null }),
          city: values.city,
          state: values.state,
          pincode: values.pincode,
        });
        setAddresses(addresses.map((a) => (a.id === editingAddressId ? updated : a)));
        setEditingAddressId(null);
      } else {
        const newAddress = await createMyAddress(accessToken, {
          fullName: values.fullName,
          phone: values.phone,
          line1: values.line1,
          ...(values.line2?.trim() ? { line2: values.line2.trim() } : {}),
          city: values.city,
          state: values.state,
          pincode: values.pincode,
          isDefault: addresses.length === 0,
        });
        setAddresses([...addresses, newAddress]);
        setShowAddForm(false);
      }
      addressForm.reset();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateMyAddress(accessToken, id, { isDefault: true });
      setAddresses(addresses.map((a) => ({
        ...a,
        isDefault: a.id === id ? true : false,
      })));
      setAddresses((prev) => prev.map((a) => (a.id === id ? updated : { ...a, isDefault: false })));
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleEditAddress = (address: UserAddress) => {
    setEditingAddressId(address.id);
    setShowAddForm(false);
    addressForm.reset({
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
    if (!confirm("Are you sure you want to delete this address?")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteMyAddress(accessToken, id);
      setAddresses(addresses.filter((a) => a.id !== id));
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cancelAddressForm = () => {
    setShowAddForm(false);
    setEditingAddressId(null);
    addressForm.reset();
  };

  const profileErrors = profileForm.formState.errors;
  const addrErrors = addressForm.formState.errors;

  return (
    <section className="grid gap-8">
      {/* Profile Section */}
      <div className="rounded-lg border border-border p-4 sm:p-6">
        <h1 className="mb-4 font-heading text-xl font-semibold sm:text-2xl">Profile</h1>
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
        {profileSuccess && (
          <p className="mb-4 rounded-md bg-[#eff5ee] px-3 py-2 text-sm font-medium text-[#23403d]">
            Profile updated successfully.
          </p>
        )}
        <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium">First Name</label>
              <input
                {...profileForm.register("firstName")}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              {profileErrors.firstName && (
                <p className="text-xs text-destructive">{profileErrors.firstName.message}</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium">Last Name</label>
              <input
                {...profileForm.register("lastName")}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <label className="text-xs font-medium">Email</label>
              <input
                type="email"
                {...profileForm.register("email")}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              {profileErrors.email && (
                <p className="text-xs text-destructive">{profileErrors.email.message}</p>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={profileBusy}>
              {profileBusy ? "Saving..." : "Save Profile"}
            </Button>
          </div>
        </form>
      </div>

      {/* Addresses Section */}
      <div className="rounded-lg border border-border p-4 sm:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-heading text-xl font-semibold sm:text-2xl">Saved Addresses</h2>
          {!showAddForm && !editingAddressId && (
            <Button onClick={() => setShowAddForm(true)} disabled={busy} size="sm">
              Add New Address
            </Button>
          )}
        </div>

        {(showAddForm || editingAddressId) && (
          <form
            onSubmit={addressForm.handleSubmit(onAddressSubmit)}
            className="mb-6 grid gap-4 rounded-md bg-muted/30 p-4"
          >
            <h3 className="text-sm font-medium">
              {editingAddressId ? "Edit Address" : "Add New Address"}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label className="text-xs font-medium">Full Name</label>
                <input
                  {...addressForm.register("fullName")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                {addrErrors.fullName && (
                  <p className="text-xs text-destructive">{addrErrors.fullName.message}</p>
                )}
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium">Phone</label>
                <input
                  {...addressForm.register("phone")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                {addrErrors.phone && (
                  <p className="text-xs text-destructive">{addrErrors.phone.message}</p>
                )}
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <label className="text-xs font-medium">Line 1</label>
                <input
                  {...addressForm.register("line1")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                {addrErrors.line1 && (
                  <p className="text-xs text-destructive">{addrErrors.line1.message}</p>
                )}
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <label className="text-xs font-medium">Line 2 (Optional)</label>
                <input
                  {...addressForm.register("line2")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium">City</label>
                <input
                  {...addressForm.register("city")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                {addrErrors.city && (
                  <p className="text-xs text-destructive">{addrErrors.city.message}</p>
                )}
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium">State</label>
                <input
                  {...addressForm.register("state")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                {addrErrors.state && (
                  <p className="text-xs text-destructive">{addrErrors.state.message}</p>
                )}
              </div>
              <div className="grid gap-1.5">
                <label className="text-xs font-medium">Pincode</label>
                <input
                  {...addressForm.register("pincode")}
                  maxLength={6}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                {addrErrors.pincode && (
                  <p className="text-xs text-destructive">{addrErrors.pincode.message}</p>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" size="sm" onClick={cancelAddressForm} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? "Saving..." : editingAddressId ? "Update Address" : "Save Address"}
              </Button>
            </div>
          </form>
        )}

        <div className="grid gap-3">
          {loading ? (
            <div className="grid gap-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded border border-border bg-muted" />
              ))}
            </div>
          ) : !showAddForm && !editingAddressId && addresses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved addresses.</p>
          ) : (
            addresses.map((address) => (
              <article
                key={address.id}
                className="flex flex-col gap-3 rounded border border-border p-3 text-sm sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{address.fullName}</p>
                    {address.isDefault && (
                      <span className="rounded-full bg-[#eff5ee] px-2 py-0.5 text-[10px] font-bold text-[#23403d]">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground">{address.phone}</p>
                  <p className="mt-1">{address.line1}</p>
                  {address.line2 && <p>{address.line2}</p>}
                  <p>
                    {address.city}, {address.state} - {address.pincode}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!address.isDefault && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleSetDefault(address.id)}
                    >
                      Set Default
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => handleEditAddress(address)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy}
                    onClick={() => handleDelete(address.id)}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
