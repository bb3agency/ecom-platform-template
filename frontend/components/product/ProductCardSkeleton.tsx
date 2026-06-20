import { Skeleton } from "@/components/ui/skeleton";

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/[0.04]">
      {/* Image — matches new 4:3 aspect */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[#f5f0eb]">
        <Skeleton className="absolute inset-0 rounded-none" />
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-3.5">
        <Skeleton className="mb-1.5 h-3 w-16 rounded-full" />
        <Skeleton className="mb-1 h-4 w-4/5" />
        <Skeleton className="mb-2.5 h-3 w-full" />
        <Skeleton className="mb-4 h-3 w-2/3" />

        <div className="mt-auto flex items-center justify-between pt-1">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-9 w-16 rounded-full" />
        </div>
      </div>
    </div>
  );
}
