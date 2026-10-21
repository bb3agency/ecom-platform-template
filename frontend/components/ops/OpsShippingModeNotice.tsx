import { Truck } from "lucide-react";
import { Notice } from "@/components/ui/console";
import type { OpsConfigOverview } from "@/lib/ops-client-api";

/** Which courier(s) can quote rates at checkout, from the keys present at runtime. */
export function OpsShippingModeNotice({ overview }: { overview: OpsConfigOverview }) {
  const shipping = overview.domains.find((d) => d.domain === "shipping");
  const items = new Map(shipping?.items.map((i) => [i.key, i]) ?? []);
  const hasDelhivery = Boolean(items.get("DELHIVERY_API_KEY")?.present);
  const hasShiprocket = Boolean(items.get("SHIPROCKET_EMAIL")?.present) && Boolean(items.get("SHIPROCKET_PASSWORD")?.present);

  if (hasDelhivery && hasShiprocket) {
    return (
      <div className="px-4 py-3 sm:px-5">
        <Notice tone="success" icon={Truck} title="Both couriers are set up">
          Checkout asks Delhivery and Shiprocket for rates and assigns each order to the cheaper one.
        </Notice>
      </div>
    );
  }
  if (hasDelhivery || hasShiprocket) {
    return (
      <div className="px-4 py-3 sm:px-5">
        <Notice tone="info" icon={Truck} title={`Only ${hasDelhivery ? "Delhivery" : "Shiprocket"} is set up`}>
          Add the other courier&apos;s credentials to compare rates on every order.
        </Notice>
      </div>
    );
  }
  return (
    <div className="px-4 py-3 sm:px-5">
      <Notice tone="danger" icon={Truck} title="No courier is set up">
        Shoppers can&apos;t get delivery rates at checkout. Add Delhivery or Shiprocket credentials, save, then restart.
      </Notice>
    </div>
  );
}
