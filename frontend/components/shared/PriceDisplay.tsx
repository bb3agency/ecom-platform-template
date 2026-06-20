import { formatPrice } from "@/lib/format-price";

interface PriceDisplayProps {
  pricePaise: number;
  originalPricePaise?: number;
}

export function PriceDisplay({
  pricePaise,
  originalPricePaise,
}: PriceDisplayProps) {
  return (
    <div className="flex items-center gap-2">
      {typeof originalPricePaise === "number" &&
      originalPricePaise > pricePaise ? (
        <span className="text-sm text-muted-foreground line-through">
          {formatPrice(originalPricePaise)}
        </span>
      ) : null}
      <span className={`text-base font-bold ${typeof originalPricePaise === "number" && originalPricePaise > pricePaise ? "text-accent" : "text-foreground"}`}>
        {formatPrice(pricePaise)}
      </span>
    </div>
  );
}
