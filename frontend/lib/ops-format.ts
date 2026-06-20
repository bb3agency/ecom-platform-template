export function formatOpsDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatOpsRelativeExpiry(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) {
    return "Expired";
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) {
    return `${minutes}m left`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m left`;
}
