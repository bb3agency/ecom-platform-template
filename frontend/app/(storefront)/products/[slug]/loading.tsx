export default function ProductDetailLoading() {
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-[55%_45%]">
      <div className="aspect-[4/5] animate-pulse rounded-lg bg-muted" />
      <div className="grid gap-3">
        <div className="h-10 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-6 w-1/4 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
