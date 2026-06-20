/**
 * Production environment variable validation.
 * Called once at module evaluation time during server startup.
 * Throws immediately on missing required variables so the process fails fast
 * rather than serving broken responses silently.
 *
 * Only runs on the server (Node.js) and only in production mode.
 * Never throws in browser or development environments.
 */

interface EnvSpec {
  key: string;
  description: string;
  /** true = check NEXT_PUBLIC_ prefix too (client-exposed vars) */
  public?: boolean;
}

const REQUIRED_PROD_ENV: EnvSpec[] = [
  { key: "NEXT_PUBLIC_API_BASE_URL", description: "Backend API URL (must include /api/v1)", public: true },
  { key: "NEXT_PUBLIC_STOREFRONT_URL", description: "Canonical storefront URL", public: true },
  { key: "NEXT_PUBLIC_RAZORPAY_KEY_ID", description: "Razorpay test/live public key", public: true },
  { key: "INTERNAL_API_BASE_URL", description: "Internal backend URL for server-side API calls (must include /api/v1)" },
];

export function validateProductionEnv(): void {
  if (typeof window !== "undefined") return;
  if (process.env.NODE_ENV !== "production") return;

  const missing: string[] = [];

  for (const spec of REQUIRED_PROD_ENV) {
    const value = process.env[spec.key];
    if (!value || value.trim() === "") {
      missing.push(`  ${spec.key} — ${spec.description}`);
      continue;
    }
    // Validate URL-shaped vars
    if (spec.key.includes("URL") || spec.key.includes("BASE")) {
      try {
        new URL(value);
      } catch {
        missing.push(`  ${spec.key} — not a valid URL: "${value}"`);
      }
    }
    // API base URL must end with /api/v1
    if (spec.key === "NEXT_PUBLIC_API_BASE_URL" && !value.includes("/api/v1")) {
      missing.push(`  ${spec.key} — must include /api/v1 (got "${value}")`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[config] Missing or invalid required production environment variables:\n${missing.join("\n")}\n` +
      `Copy .env.production.example to .env.production.local and fill in all values before building.`,
    );
  }
}
