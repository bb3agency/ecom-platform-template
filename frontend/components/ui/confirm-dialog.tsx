"use client";

import * as React from "react";
import { AlertTriangleIcon, Trash2Icon, type LucideIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ConfirmOptions {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  tone?: "destructive" | "primary";
  icon?: LucideIcon;
  typeToConfirm?: string;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonMinLength?: number;
}

/**
 * Promise-based confirm — the drop-in replacement for `window.confirm()`.
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   ...
 *   const ok = await confirm({ title: "Delete Product?", description: "…", confirmLabel: "Delete" });
 *   if (!ok) return;            // cancelled
 *   // ok.reason carries the typed reason when reasonLabel was set
 *
 * Render `{confirmDialog}` once in the component's JSX.
 */
export function useConfirm() {
  const [pending, setPending] = React.useState<{
    options: ConfirmOptions;
    resolve: (result: { reason: string } | false) => void;
  } | null>(null);

  const confirm = React.useCallback(
    (options: ConfirmOptions) =>
      new Promise<{ reason: string } | false>((resolve) => {
        setPending({ options, resolve });
      }),
    [],
  );

  const confirmDialog = pending ? (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          pending.resolve(false);
          setPending(null);
        }
      }}
      {...pending.options}
      onConfirm={({ reason }) => {
        pending.resolve({ reason });
        setPending(null);
      }}
    />
  ) : null;

  return { confirm, confirmDialog };
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Delete Product?" */
  title: string;
  /** Warning copy. Mention the entity by name for context. */
  description: React.ReactNode;
  /** Confirm button label, e.g. "Delete Product". */
  confirmLabel: string;
  /**
   * Called when the user confirms. May be async — the confirm button shows a
   * spinner until it settles. Receives the reason text when `reasonLabel` is set.
   * Resolve to close; throw to keep the dialog open (caller shows the error toast).
   */
  onConfirm: (details: { reason: string }) => void | Promise<void>;
  /** destructive (red, default) or primary (brand) confirm styling. */
  tone?: "destructive" | "primary";
  /** Icon inside the header circle. Defaults to trash (destructive) / warning. */
  icon?: LucideIcon;
  /**
   * Require typing this exact text (e.g. "DELETE" or the entity name) before
   * the confirm button enables. For irreversible actions.
   */
  typeToConfirm?: string;
  /** Render a required reason field with this label (e.g. "Reason for ban"). */
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** Minimum reason length when `reasonLabel` is set (default 3). */
  reasonMinLength?: number;
  /** Extra content between the description and the footer (previews, selects). */
  children?: React.ReactNode;
}

/**
 * Standard confirmation modal for destructive/irreversible actions — the
 * design-system replacement for every `window.confirm()`. Centered icon,
 * title, contextual description, optional type-to-confirm and reason fields,
 * Cancel + tone-colored confirm with built-in loading state.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  tone = "destructive",
  icon,
  typeToConfirm,
  reasonLabel,
  reasonPlaceholder,
  reasonMinLength = 3,
  children,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // Reset transient state whenever the dialog opens fresh.
  React.useEffect(() => {
    if (open) {
      setTyped("");
      setReason("");
      setBusy(false);
    }
  }, [open]);

  const typeOk = !typeToConfirm || typed.trim() === typeToConfirm;
  const reasonOk = !reasonLabel || reason.trim().length >= reasonMinLength;
  const canConfirm = typeOk && reasonOk && !busy;

  const HeaderIcon = icon ?? (tone === "destructive" ? Trash2Icon : AlertTriangleIcon);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm({ reason: reason.trim() });
      onOpenChange(false);
    } catch {
      // Caller surfaces the error (toast); keep the dialog open for retry.
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent>
        <div className="flex flex-col items-center gap-3 px-6 pt-8">
          <div
            className={cn(
              "flex size-14 items-center justify-center rounded-full",
              tone === "destructive" ? "bg-red-500/10 text-red-600" : "bg-primary/10 text-primary",
            )}
          >
            <HeaderIcon className="size-6" />
          </div>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </div>

        <div className="flex flex-col gap-3 px-6 pt-4 pb-2 empty:hidden">
          {children}
          {reasonLabel && (
            <label className="flex flex-col gap-1.5 text-left">
              <span className="text-sm font-medium text-foreground">{reasonLabel}</span>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={reasonPlaceholder ?? "Add a short reason…"}
                rows={3}
                disabled={busy}
              />
            </label>
          )}
          {typeToConfirm && (
            <label className="flex flex-col gap-1.5 text-left">
              <span className="text-sm text-muted-foreground">
                Type <span className="font-semibold text-foreground">{typeToConfirm}</span> to confirm
              </span>
              <Input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={typeToConfirm}
                disabled={busy}
                autoComplete="off"
              />
            </label>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 px-6 pt-2 pb-6">
          <AlertDialogClose
            render={<Button variant="outline" className="min-w-28" disabled={busy} />}
          >
            Cancel
          </AlertDialogClose>
          <Button
            className={cn(
              "min-w-28",
              tone === "destructive" && "bg-red-600 text-white hover:bg-red-700",
            )}
            variant={tone === "destructive" ? undefined : "default"}
            disabled={!canConfirm}
            loading={busy}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
