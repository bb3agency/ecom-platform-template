export default function ProductsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="mb-8 h-9 w-48 animate-pulse rounded-md bg-muted" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[3/4] animate-pulse rounded-lg bg-muted"
          />
        ))}
      </div>
    </div>
  );
}
