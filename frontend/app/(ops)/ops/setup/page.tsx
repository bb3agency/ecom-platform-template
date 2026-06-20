import { OpsPublicLayout } from "@/components/ops/OpsPublicLayout";
import { OpsSetupForm } from "@/components/ops/OpsSetupForm";
import { OpsAlert } from "@/components/ops/ui/ops-ui";

interface OpsSetupPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OpsSetupPage({ searchParams }: OpsSetupPageProps) {
  const params = await searchParams;
  const tokenValue = params.token;
  const token = Array.isArray(tokenValue) ? tokenValue[0] : tokenValue;

  return (
    <OpsPublicLayout
      title="Complete your invite"
      description="One-time onboarding for a new platform operator. Finish within the invite expiry window."
    >
      {!token ? (
        <OpsAlert tone="warning" title="Missing invite token">
          Re-open the secure link from your ops invite email. Links expire in 10 minutes.
        </OpsAlert>
      ) : (
        <OpsSetupForm token={token} />
      )}
    </OpsPublicLayout>
  );
}
