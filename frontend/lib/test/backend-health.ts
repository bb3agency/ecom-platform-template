import { getInternalApiBaseUrl } from "@/lib/api-base";

export async function isBackendHealthy(
  apiBase: string = getInternalApiBaseUrl(),
): Promise<boolean> {
  try {
    const res = await fetch(`${apiBase.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

