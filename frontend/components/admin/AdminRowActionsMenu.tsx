"use client";

import { MoreHorizontal, Trash2, Copy, Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface AdminRowActionsMenuProps {
  disabled?: boolean;
  onDeletePermanently: () => void;
  storefrontUrl?: string;
  className?: string;
  triggerClassName?: string;
}

const MENU_WIDTH = 176;

export function AdminRowActionsMenu({
  disabled = false,
  onDeletePermanently,
  storefrontUrl,
  className,
  triggerClassName,
}: AdminRowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async () => {
    if (!storefrontUrl) return;
    try {
      await navigator.clipboard.writeText(storefrontUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy the storefront link:", storefrontUrl);
    }
    closeMenu();
  };
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  function closeMenu() {
    setOpen(false);
    setMenuStyle(null);
  }

  function toggleMenu() {
    if (open) {
      closeMenu();
      return;
    }

    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;

    setMenuStyle({
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - MENU_WIDTH),
    });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;

    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label="More actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={toggleMenu}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-60",
          triggerClassName,
        )}
      >
        <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
      </button>

      {open &&
        menuStyle &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[100] min-w-44 overflow-hidden rounded-lg border border-border/50 bg-card p-1 shadow-lg"
            style={{ top: menuStyle.top, left: menuStyle.left }}
          >
            {storefrontUrl ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
                  onClick={() => void handleCopyLink()}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {copied ? "Copied!" : "Copy storefront link"}
                </button>
                <a
                  role="menuitem"
                  href={storefrontUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
                  onClick={() => closeMenu()}
                >
                  <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  View on storefront
                </a>
                <hr className="my-1 border-border/40" />
              </>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
              onClick={() => {
                closeMenu();
                onDeletePermanently();
              }}
            >
              <Trash2 className="h-3.5 w-3.5 shrink-0" />
              Delete Permanently
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
