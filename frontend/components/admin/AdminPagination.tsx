"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PaginationMeta } from "@/lib/admin-api";

interface AdminPaginationProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
}

/** Previous / page x of y / next. Compact enough to sit on one line on phones. */
export function AdminPagination({ meta, onPageChange }: AdminPaginationProps) {
  const { page, totalPages, total } = meta;
  if (totalPages <= 1) {
    return (
      <p className="text-sm text-muted-foreground tabular">
        {total.toLocaleString("en-IN")} {total === 1 ? "result" : "results"}
      </p>
    );
  }

  return (
    <nav aria-label="Pagination" className="flex items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft aria-hidden />
      </Button>
      <span className="min-w-20 text-center text-sm text-muted-foreground tabular">
        {page} of {totalPages}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight aria-hidden />
      </Button>
    </nav>
  );
}
