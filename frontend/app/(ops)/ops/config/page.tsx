import { OpsConfigPagePanel } from "@/components/ops/OpsConfigPagePanel";
import type { OpsConfigShowFilter } from "@/components/ops/OpsConfigEditor";

interface OpsConfigPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const SHOW_VALUES: OpsConfigShowFilter[] = ["all", "missing", "restart", "edited"];

export default async function OpsConfigPage({ searchParams }: OpsConfigPageProps) {
  const params = await searchParams;
  const show = Array.isArray(params.show) ? params.show[0] : params.show;
  const initialShow = SHOW_VALUES.find((value) => value === show) ?? "all";
  return <OpsConfigPagePanel initialShow={initialShow} />;
}
