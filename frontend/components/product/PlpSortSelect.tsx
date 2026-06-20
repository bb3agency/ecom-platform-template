"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

const SORT_OPTIONS = [
  { label: "Newest", value: "newest" },
  { label: "Most Popular", value: "popularity" },
  { label: "Price: Low to High", value: "price_asc" },
  { label: "Price: High to Low", value: "price_desc" },
];

interface PlpSortSelectProps {
  current: string;
}

export function PlpSortSelect({ current }: PlpSortSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", e.target.value);
    params.set("page", "1");
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <select
      value={current}
      onChange={handleChange}
      className="h-10 cursor-pointer rounded-full border border-[#efe8e4] bg-white px-4 pr-10 text-sm font-bold text-[#23403d] shadow-sm focus:border-[#23403d] focus:outline-none focus:ring-1 focus:ring-[#23403d]"
      aria-label="Sort products"
    >
      {SORT_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
