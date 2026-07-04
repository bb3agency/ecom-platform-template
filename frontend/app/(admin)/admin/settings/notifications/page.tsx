import { NotificationsChannelPanel } from "@/components/admin/NotificationsChannelPanel";
import { AdminMyOrderAlertsPanel } from "@/components/admin/AdminMyOrderAlertsPanel";

export const metadata = {
  title: "Notification Settings — Admin",
};

export default function NotificationSettingsPage() {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      {/* Personal opt-in (per signed-in admin) — sits above the store-wide routing. */}
      <AdminMyOrderAlertsPanel />
      <NotificationsChannelPanel />
    </div>
  );
}
