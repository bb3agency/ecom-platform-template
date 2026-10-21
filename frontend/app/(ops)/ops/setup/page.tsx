import { OpsPublicLayout } from "@/components/ops/OpsPublicLayout";
import { OpsSetupForm } from "@/components/ops/OpsSetupForm";
import { Notice } from "@/components/ui/console";

interface OpsSetupPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OpsSetupPage({ searchParams }: OpsSetupPageProps) {
  const params = await searchParams;
  const tokenValue = params.token;
  const token = Array.isArray(tokenValue) ? tokenValue[0] : tokenValue;

  return (
    <OpsPublicLayout
      title="Set up your ops account"
      description="Confirm your details and we'll email a code to finish. The invite link works for 10 minutes."
    >
      {!token ? (
        <Notice tone="warning" title="This link is incomplete">
          Open the setup link from your invite email again. If it has expired, ask an operator to send a new invite.
        </Notice>
      ) : (
        <OpsSetupForm token={token} />
      )}
    </OpsPublicLayout>
  );
}
