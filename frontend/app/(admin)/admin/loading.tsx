export default function AdminLoading() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-48 animate-pulse rounded-lg bg-muted" />
      <div className="h-48 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
