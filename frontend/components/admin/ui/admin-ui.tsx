"use client";

import { Loader2 } from "lucide-react";

export function AdminLoadingBlock({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-500">
      <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

export function AdminBadge({
  status,
}: {
  status: "success" | "warning" | "destructive" | "default";
}) {
  const styles = {
    success: "bg-success/10 text-success hover:bg-success/10",
    warning: "bg-warning-soft text-warning hover:bg-warning-soft",
    destructive: "bg-destructive/10 text-destructive hover:bg-destructive/10",
    default: "bg-foreground text-muted-foreground hover:bg-foreground",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${styles[status]}`}
    >
      {status}
    </span>
  );
}
