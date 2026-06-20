import { OpsLoadShedPanel } from "@/components/ops/OpsLoadShedPanel";
import { OpsPageFrame } from "@/components/ops/ui/ops-ui";

export default function LoadShedPage() {
  return (
    <OpsPageFrame
      title="Load shedding"
      description="Control runtime traffic protection modes. Changes apply immediately after email OTP verification."
    >
      <OpsLoadShedPanel />
    </OpsPageFrame>
  );
}
