import { OpsConfigPagePanel } from "@/components/ops/OpsConfigPagePanel";
import { OpsPageFrame } from "@/components/ops/ui/ops-ui";

export default function OpsConfigPage() {
  return (
    <OpsPageFrame
      title="Configuration"
      description="DB-overlay secrets by section, OTP-protected save, and runtime readiness."
    >
      <OpsConfigPagePanel />
    </OpsPageFrame>
  );
}
