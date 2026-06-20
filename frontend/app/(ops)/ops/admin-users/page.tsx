import { OpsAdminUsersPanel } from "@/components/ops/OpsAdminUsersPanel";
import { OpsPageFrame } from "@/components/ops/ui/ops-ui";

export default function OpsAdminUsersPage() {
  return (
    <OpsPageFrame
      title="Merchant admins"
      description="Active merchant admin accounts, permissions, and OTP-gated deactivation."
    >
      <OpsAdminUsersPanel />
    </OpsPageFrame>
  );
}
