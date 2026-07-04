"use client";

import Link from "next/link";
import { Leaf, MapPin, Phone, Mail } from "lucide-react";
// Brand glyphs: lucide-react ships no brand icons — react-icons is the one
// sanctioned exception, used ONLY for social brand logos (tree-shaken imports).
import { FaFacebookF, FaInstagram, FaWhatsapp } from "react-icons/fa6";
import { APP_NAME } from "@/lib/constants";
import type { CategoryWithMeta } from "@/lib/categories";
import { useStoreConfig } from "@/components/providers/StoreConfigProvider";

interface FooterProps {
  categories: CategoryWithMeta[];
}


export function Footer({ categories }: FooterProps) {
  // Merchant-managed store identity/contact (Admin → Settings → Store), synced via
  // GET /store/config. Neutral fallbacks until the merchant configures them.
  const config = useStoreConfig();
  const displayAddress = config.storeAddress?.trim() || APP_NAME;
  const contactPhone = config.contactPhone?.trim() || "";
  const contactEmail = config.contactEmail?.trim() || "";
  const telHref = `tel:${contactPhone.replace(/[^\d+]/g, "")}`;

  // Social links: Facebook/Instagram are merchant-managed (Admin → Settings →
  // Store); WhatsApp derives from the same contact phone shown below — no
  // separate setting. Icons render only when their target is configured.
  const facebookUrl = config.facebookUrl?.trim() || "";
  const instagramUrl = config.instagramUrl?.trim() || "";
  const whatsappDigits = contactPhone.replace(/\D/g, "");
  // wa.me needs country code; default bare 10-digit Indian numbers to +91.
  const whatsappHref = whatsappDigits
    ? `https://wa.me/${whatsappDigits.length === 10 ? `91${whatsappDigits}` : whatsappDigits}`
    : "";
  const socialLinks = [
    { label: "Facebook", href: facebookUrl, icon: <FaFacebookF className="size-4" aria-hidden /> },
    { label: "Instagram", href: instagramUrl, icon: <FaInstagram className="size-4" aria-hidden /> },
    { label: "WhatsApp", href: whatsappHref, icon: <FaWhatsapp className="size-4" aria-hidden /> },
  ].filter((s) => s.href);

  return (
    <footer className="border-t border-[#efe8e4] bg-[#faf3ef] text-[#23403d]">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-10 sm:py-16 lg:px-8">
        <div className="grid gap-8 sm:grid-cols-2 sm:gap-12 lg:grid-cols-4 lg:gap-8">
          {/* Brand column */}
          <div className="flex flex-col gap-6">
            <Link
              href="/"
              className="flex items-center gap-2 font-heading text-2xl font-bold tracking-tight text-[#23403d]"
              aria-label={`${APP_NAME} home`}
            >
              <Leaf className="size-6 text-[#ec6e55]" aria-hidden />
              {APP_NAME}
            </Link>
            <p className="text-sm font-medium leading-relaxed text-[#767676]">
              Farm-fresh chemical free produce delivered to your door. Trusted by
              families across India for quality and purity.
            </p>
            {socialLinks.length > 0 ? (
              <div className="flex gap-3">
                {socialLinks.map((social) => (
                  <a
                    key={social.label}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex size-10 items-center justify-center rounded-full bg-white text-[#23403d] shadow-sm transition-colors hover:bg-[#ec6e55] hover:text-white"
                    aria-label={social.label}
                  >
                    {social.icon}
                  </a>
                ))}
              </div>
            ) : null}
          </div>

          {/* Quick links */}
          <div>
            <h3 className="mb-4 font-heading text-base font-bold text-[#23403d] sm:mb-6 sm:text-lg">
              Quick Links
            </h3>
            <ul className="space-y-3 text-sm font-bold text-[#767676] sm:space-y-4">
              <li>
                <Link href="/products" className="transition-colors hover:text-[#ec6e55]">
                  Shop All
                </Link>
              </li>
              {categories.slice(0, 3).map((cat) => (
                <li key={cat.slug}>
                  <Link
                    href={`/categories/${cat.slug}`}
                    className="transition-colors hover:text-[#ec6e55]"
                  >
                    {cat.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/products?sort=popularity" className="transition-colors hover:text-[#ec6e55]">
                  Special Offers
                </Link>
              </li>
            </ul>
          </div>

          {/* Policies */}
          <div>
            <h3 className="mb-6 font-heading text-lg font-bold text-[#23403d]">
              Policies
            </h3>
            <ul className="space-y-4 text-sm font-bold text-[#767676]">
              {[
                { label: "About Us", href: "/about" },
                { label: "Privacy Policy", href: "/privacy" },
                { label: "Terms & Conditions", href: "/terms" },
                { label: "Shipping Policy", href: "/shipping" },
                { label: "Return Policy", href: "/returns" },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="transition-colors hover:text-[#ec6e55]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="mb-6 font-heading text-lg font-bold text-[#23403d]">
              Contact Us
            </h3>
            <ul className="space-y-4 text-sm font-bold text-[#767676]">
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-5 shrink-0 text-[#ec6e55]" aria-hidden />
                <span>{displayAddress}</span>
              </li>
              {contactPhone ? (
                <li className="flex items-center gap-3">
                  <Phone className="size-5 shrink-0 text-[#ec6e55]" aria-hidden />
                  <a href={telHref} className="transition-colors hover:text-[#ec6e55]">
                    {contactPhone}
                  </a>
                </li>
              ) : null}
              {contactEmail ? (
                <li className="flex items-center gap-3">
                  <Mail className="size-5 shrink-0 text-[#ec6e55]" aria-hidden />
                  <a href={`mailto:${contactEmail}`} className="transition-colors hover:text-[#ec6e55]">
                    {contactEmail}
                  </a>
                </li>
              ) : null}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-[#efe8e4] pt-6 text-xs font-medium text-[#767676] sm:mt-16 sm:flex-row sm:gap-4 sm:pt-8 sm:text-sm">
          <p>&copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.</p>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1"><Leaf className="size-3 text-[#ec6e55]" /> 100% Chemical Free</span>
            <span className="hidden sm:inline">&bull;</span>
            <span className="hidden sm:flex items-center gap-1">Pesticide Free</span>
            <span className="hidden sm:inline">&bull;</span>
            <span className="hidden sm:flex items-center gap-1">Farm to Table</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
