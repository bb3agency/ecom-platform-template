import { OpsInvitesPanel } from "@/components/ops/OpsInvitesPanel";

interface OpsInvitesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OpsInvitesPage({ searchParams }: OpsInvitesPageProps) {
  const params = await searchParams;
  const invite = Array.isArray(params.invite) ? params.invite[0] : params.invite;
  return <OpsInvitesPanel initialInvite={invite === "operator" || invite === "admin" ? invite : null} />;
}
