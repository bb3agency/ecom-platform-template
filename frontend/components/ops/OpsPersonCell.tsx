import { Monogram } from "@/components/ui/console";

interface OpsPersonCellProps {
  name: string;
  email: string;
  /** Marks the signed-in operator's own row. */
  you?: boolean;
}

/** Avatar initial + name + email, truncating long values with the full email in `title`. */
export function OpsPersonCell({ name, email, you }: OpsPersonCellProps) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Monogram name={name} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {name}
          {you ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={email}>
          {email}
        </p>
      </div>
    </div>
  );
}
