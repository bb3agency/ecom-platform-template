"use client";

import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/lib/admin-api";

interface AdminPaginationProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
}

export function AdminPagination({ meta, onPageChange }: AdminPaginationProps) {
  const { page, totalPages, total } = meta;
  if (totalPages <= 1) {
    return (
      <p className="text-xs text-muted-foreground">
        {total} {total === 1 ? "row" : "rows"}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">
        Page {page} of {totalPages} · {total} total
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
