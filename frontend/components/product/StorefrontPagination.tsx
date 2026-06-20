import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface StorefrontPaginationProps {
  page: number;
  totalPages: number;
  basePath: string;
  searchParams?: Record<string, string | undefined>;
}

function buildHref(
  basePath: string,
  page: number,
  searchParams?: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value && key !== "page") params.set(key, value);
    }
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function StorefrontPagination({
  page,
  totalPages,
  basePath,
  searchParams,
}: StorefrontPaginationProps) {
  if (totalPages <= 1) return null;

  const prevPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);

  return (
    <nav
      className="mt-10 flex items-center justify-center gap-3"
      aria-label="Product pagination"
    >
      <Link
        href={buildHref(basePath, prevPage, searchParams)}
        aria-disabled={page <= 1}
        className={`inline-flex h-10 items-center gap-1 rounded-full border border-[#dbe8d8] bg-white px-4 text-sm font-bold text-[#23403d] transition-colors hover:border-[#23403d] ${
          page <= 1 ? "pointer-events-none opacity-40" : ""
        }`}
      >
        <ChevronLeft className="size-4" aria-hidden />
        Previous
      </Link>
      <span className="text-sm font-semibold text-[#767676]">
        Page {page} of {totalPages}
      </span>
      <Link
        href={buildHref(basePath, nextPage, searchParams)}
        aria-disabled={page >= totalPages}
        className={`inline-flex h-10 items-center gap-1 rounded-full border border-[#dbe8d8] bg-white px-4 text-sm font-bold text-[#23403d] transition-colors hover:border-[#23403d] ${
          page >= totalPages ? "pointer-events-none opacity-40" : ""
        }`}
      >
        Next
        <ChevronRight className="size-4" aria-hidden />
      </Link>
    </nav>
  );
}
