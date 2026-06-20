"use client";

import { OpsCriticalOtpForm } from "@/components/ops/OpsCriticalOtpForm";
import { useOpsCanWrite } from "@/components/ops/OpsSessionProvider";
import { OpsAlert, OpsField, OpsInput } from "@/components/ops/ui/ops-ui";
import { scheduleOpsSystemRestart } from "@/lib/ops-client-api";

export function OpsSystemPanel() {
  const canWrite = useOpsCanWrite();

  if (!canWrite) {
    return (
      <OpsAlert tone="warning">
        Read-only session — scheduling restarts requires ops:write.
      </OpsAlert>
    );
  }

  return (
    <div className="grid gap-6">
      <OpsAlert tone="warning" title="Payment-safe restart">
        Backend drains in-flight PREPAID orders before signaling API and worker containers to restart.
        Load-shed switches to emergency during the window.
      </OpsAlert>

      <OpsCriticalOtpForm
        actionType="system-restart"
        title="Schedule process restart"
        description="Queues a cart-cleanup job. delayMinutes 0 runs immediately (max 1440)."
        buttonLabel="Schedule restart"
        variant="danger"
        onExecute={async ({ challengeId, otpCode }) => {
          const delayMinutes = Number(
            (document.getElementById("restart-delay") as HTMLInputElement | null)?.value ?? "5",
          );
          await scheduleOpsSystemRestart({ delayMinutes, challengeId, otpCode });
        }}
      >
        <OpsField label="Delay (minutes)" htmlFor="restart-delay" hint="0 = now, up to 1440 (24h)">
          <OpsInput id="restart-delay" type="number" min={0} max={1440} defaultValue={5} />
        </OpsField>
      </OpsCriticalOtpForm>
    </div>
  );
}
