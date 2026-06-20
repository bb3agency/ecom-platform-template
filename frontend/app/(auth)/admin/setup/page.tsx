import { AdminSetupForm } from "@/components/admin/AdminSetupForm";

interface AdminSetupPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminSetupPage({ searchParams }: AdminSetupPageProps) {
  const params = await searchParams;
  const tokenValue = params.token;
  const token = Array.isArray(tokenValue) ? tokenValue[0] : tokenValue;

  if (!token) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Missing invite token. Re-open the admin invite link.
      </p>
    );
  }

  return <AdminSetupForm token={token} />;
}
