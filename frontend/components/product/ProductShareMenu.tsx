"use client";

import { useEffect, useRef, useState } from "react";
import { Share2, Copy, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductShareMenuProps {
  productName: string;
  productUrl: string;
}

const SHARE_CHANNELS = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    color: "#25D366",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden>
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    ),
    getUrl: (url: string, text: string) =>
      `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  },
  {
    id: "telegram",
    label: "Telegram",
    color: "#26A5E4",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden>
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
    getUrl: (url: string, text: string) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  {
    id: "twitter",
    label: "X (Twitter)",
    color: "#000000",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-4" aria-hidden>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
    getUrl: (url: string, text: string) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`,
  },
  {
    id: "facebook",
    label: "Facebook",
    color: "#1877F2",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" className="size-5" aria-hidden>
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
      </svg>
    ),
    getUrl: (url: string) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
] as const;

export function ProductShareMenu({ productName, productUrl }: ProductShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    function onClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const openShare = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer,width=600,height=500");
    setOpen(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(productUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy the link:", productUrl);
    }
  };

  const shareText = `Check out ${productName}`;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Share product"
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-full border border-[#e3ebe1] bg-white px-4 text-sm font-semibold text-[#23403d] shadow-sm transition-all hover:border-[#ec6e55] hover:text-[#ec6e55]",
          open && "border-[#ec6e55] text-[#ec6e55]",
        )}
      >
        <Share2 className="size-4" />
        Share
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-[#e3ebe1] bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-[#f0f0f0] px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wider text-[#767676]">Share via</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex size-6 items-center justify-center rounded-full hover:bg-[#f5f5f5]"
              aria-label="Close"
            >
              <X className="size-3.5 text-[#999]" />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1 p-3">
            {SHARE_CHANNELS.map((channel) => (
              <button
                key={channel.id}
                type="button"
                onClick={() =>
                  openShare(channel.getUrl(productUrl, shareText))
                }
                className="flex flex-col items-center gap-1.5 rounded-xl p-2.5 transition-colors hover:bg-[#f7f7f7]"
                aria-label={`Share on ${channel.label}`}
              >
                <span
                  className="flex size-10 items-center justify-center rounded-full text-white"
                  style={{ backgroundColor: channel.color }}
                >
                  {channel.icon}
                </span>
                <span className="text-center text-[9px] font-semibold leading-tight text-[#555]">
                  {channel.label}
                </span>
              </button>
            ))}
          </div>

          <div className="border-t border-[#f0f0f0] p-3">
            <div className="flex items-center gap-2 rounded-xl border border-[#e8ede7] bg-[#fafafa] p-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[#888]">
                {productUrl}
              </span>
              <button
                type="button"
                onClick={() => void copyLink()}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors",
                  copied
                    ? "bg-[#00aa63] text-white"
                    : "bg-[#23403d] text-white hover:bg-[#ec6e55]",
                )}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
