import { OpsAuditPanel } from "@/components/ops/OpsAuditPanel";
import { OpsPageFrame } from "@/components/ops/ui/ops-ui";

export default function OpsAuditPage() {
  return (
    <OpsPageFrame
      title="Audit log"
      description="Tamper-evident timeline of privileged ops actions and API mutations."
    >
      <OpsAuditPanel />
    </OpsPageFrame>
  );
}
