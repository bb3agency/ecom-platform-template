"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToastStore } from "@/stores/toast";

interface AdminCopyLinkButtonProps {
  url: string;
  label?: string;
  className?: string;
}

export function AdminCopyLinkButton({
  url,
  label = "Copy link",
  className,
}: AdminCopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (http/LAN testing) — legacy textarea copy fallback.
      try {
        const scratch = document.createElement("textarea");
        scratch.value = url;
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        document.execCommand("copy");
        document.body.removeChild(scratch);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        useToastStore.getState().push({ variant: "error", message: "Could not copy the link." });
      }
    }
  };

  return (
    <div className={cn("flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 p-2.5", className)}>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
        {url}
      </span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Open in storefront"
      >
        <ExternalLink className="size-3.5" />
      </a>
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="flex shrink-0 items-center gap-1 rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-zinc-700"
        aria-label={label}
      >
        {copied ? (
          <>
            <Check className="size-3.5 text-emerald-400" />
            Copied!
          </>
        ) : (
          <>
            <Copy className="size-3.5" />
            Copy
          </>
        )}
      </button>
    </div>
  );
}
