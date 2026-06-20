import { OpsUsersPanel } from "@/components/ops/OpsUsersPanel";
import { OpsPageFrame } from "@/components/ops/ui/ops-ui";

export default function OpsUsersPage() {
  return (
    <OpsPageFrame
      title="Operators"
      description="Active ops accounts, permissions, and deactivation (OTP required)."
    >
      <OpsUsersPanel />
    </OpsPageFrame>
  );
}
