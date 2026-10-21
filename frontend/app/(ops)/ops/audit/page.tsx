import { OpsAuditPanel } from "@/components/ops/OpsAuditPanel";

interface OpsAuditPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function OpsAuditPage({ searchParams }: OpsAuditPageProps) {
  const params = await searchParams;
  const status = Array.isArray(params.status) ? params.status[0] : params.status;
  return <OpsAuditPanel initialStatus={status === "FAILED" || status === "EXECUTED" ? status : ""} />;
}
