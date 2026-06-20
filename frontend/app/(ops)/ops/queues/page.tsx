import { OpsQueuesPanel } from "@/components/ops/OpsQueuesPanel";
import { OpsPageFrame } from "@/components/ops/ui/ops-ui";

export default function OpsQueuesPage() {
  return (
    <OpsPageFrame
      title="Queues"
      description="Bull Board monitor and dead-letter queue summary from the ops API."
    >
      <OpsQueuesPanel />
    </OpsPageFrame>
  );
}
