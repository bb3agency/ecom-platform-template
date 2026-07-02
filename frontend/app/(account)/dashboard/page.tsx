"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/stores/auth";
import { getCurrentUser } from "@/lib/users-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import {
  ShoppingBag,
  UserCircle,
  Home,
  ChevronRight,
  Package,
  MapPin,
  Leaf,
} from "lucide-react";

export default function AccountDashboardPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState<string | null>(user?.firstName ?? null);
  const [email, setEmail] = useState<string | null>(user?.email ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.firstName) {
      setName(user.firstName);
      setEmail(user.email ?? null);
      return;
    }
    let cancelled = false;
    async function load() {
      if (!accessToken) return;
      try {
        const me = await getCurrentUser(accessToken);
        if (!cancelled) {
          setName(me.firstName);
          setEmail(me.email);
        }
      } catch (err) {
        if (!cancelled) setError(getApiErrorMessage(err));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [accessToken, user]);

  const quickLinks = [
    {
      href: "/orders",
      icon: Package,
      label: "My Orders",
      description: "Track and manage your purchases",
    },
    {
      href: "/addresses",
      icon: MapPin,
      label: "Addresses",
      description: "Manage your delivery addresses",
    },
    {
      href: "/settings",
      icon: UserCircle,
      label: "Profile",
      description: "Update your personal details",
    },
  ];

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {/* Welcome card */}
      <div className="relative overflow-hidden rounded-2xl bg-[#23403d] px-6 py-7 sm:px-8 sm:py-8">
        {/* Decorative blur orbs */}
        <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-[#ec6e55] opacity-20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-8 left-10 size-32 rounded-full bg-[#c5dac2] opacity-20 blur-3xl" aria-hidden />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/10 text-white">
              <Leaf className="size-7" />
            </div>
            <div>
              {error ? (
                <p className="text-sm text-red-300">{error}</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-white/60">Welcome back</p>
                  <h2 className="mt-0.5 text-xl font-bold text-white sm:text-2xl">
                    {name ?? "Customer"}
                  </h2>
                  {email ? (
                    <p className="mt-0.5 text-sm text-white/60">{email}</p>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#ec6e55] sm:px-5"
          >
            <Home className="size-4" />
            Back to Shop
          </Link>
        </div>
      </div>

      {/* Quick links */}
      <div>
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-[#767676]">
          Quick access
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {quickLinks.map(({ href, icon: Icon, label, description }) => (
            <Link
              key={label}
              href={href}
              className="group flex items-start gap-4 rounded-2xl border border-[#efe8e4] bg-[#faf3ef] p-4 transition-all hover:border-[#ec6e55] hover:shadow-md sm:p-5"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#23403d] shadow-sm transition-colors group-hover:bg-[#ec6e55] group-hover:text-white">
                <Icon className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-[#23403d]">{label}</p>
                <p className="mt-0.5 text-xs text-[#767676]">{description}</p>
              </div>
              <ChevronRight className="ml-auto mt-1 size-4 shrink-0 text-[#767676] transition-colors group-hover:text-[#ec6e55]" />
            </Link>
          ))}
        </div>
      </div>

      {/* Recent orders teaser */}
      <div className="rounded-2xl border border-[#efe8e4] bg-[#faf3ef] p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingBag className="size-5 text-[#ec6e55]" />
            <h3 className="font-bold text-[#23403d]">Order History</h3>
          </div>
          <Link
            href="/orders"
            className="text-xs font-bold text-[#ec6e55] hover:underline"
          >
            View all
          </Link>
        </div>
        <p className="mt-3 text-sm text-[#767676]">
          Check the status of recent orders, manage returns, and discover similar products.
        </p>
        <Link
          href="/orders"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#23403d] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#ec6e55]"
        >
          <Package className="size-4" />
          View my orders
        </Link>
      </div>
    </div>
  );
}
