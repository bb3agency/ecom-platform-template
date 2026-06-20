import { OpsSystemPanel } from "@/components/ops/OpsSystemPanel";
import { OpsPageFrame } from "@/components/ops/ui/ops-ui";

export default function OpsSystemPage() {
  return (
    <OpsPageFrame
      title="System"
      description="Payment-safe API and worker restart scheduling."
    >
      <OpsSystemPanel />
    </OpsPageFrame>
  );
}
