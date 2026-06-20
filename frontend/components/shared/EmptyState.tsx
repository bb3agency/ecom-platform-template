interface EmptyStateProps {
  title: string;
  description: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center"
      role="status"
    >
      <h2 className="font-heading text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
