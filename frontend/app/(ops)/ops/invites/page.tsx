import { OpsInvitesPanel } from "@/components/ops/OpsInvitesPanel";
import { OpsPageFrame } from "@/components/ops/ui/ops-ui";

export default function OpsInvitesPage() {
  return (
    <OpsPageFrame
      title="Invites"
      description="Onboard new platform operators with time-bound setup links."
    >
      <OpsInvitesPanel />
    </OpsPageFrame>
  );
}
