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
    success: "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20",
    destructive: "bg-red-500/10 text-red-500 hover:bg-red-500/20",
    default: "bg-slate-500/10 text-slate-500 hover:bg-slate-500/20",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${styles[status]}`}
    >
      {status}
    </span>
  );
}
