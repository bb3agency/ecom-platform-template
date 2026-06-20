/** Merchant admin dev surfaces (JSON mutation panels, catalog-write). */
export function isAdminDevToolsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ADMIN_DEV_TOOLS === "true";
}
