import type { NextConfig } from "next";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateProductionEnv } from "./lib/config-validation";

// Fail fast on missing required production env vars before the server starts
validateProductionEnv();

/** Keep Turbopack scoped to `frontend/` (avoids watching the whole monorepo). */
const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

function readEnvLocalValue(key: string): string | undefined {
  const envPath = path.join(frontendRoot, ".env.local");
  if (!fs.existsSync(envPath)) {
    return undefined;
  }
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] === key && match[2]) {
      return match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

function parseDevOriginHost(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) {
    return null;
  }
  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed).hostname;
    }
  } catch {
    // fall through — treat as bare hostname / IP
  }
  return trimmed.split(":")[0] ?? null;
}

/** Upstream Fastify API for `/api/v1/*` rewrites (cookie auth requires same-site browser calls). */
const backendProxyOrigin = (
  process.env.BACKEND_PROXY_URL ??
  process.env.INTERNAL_API_BASE_URL?.replace(/\/api\/v1\/?$/, "") ??
  "http://127.0.0.1:3000"
).replace(/\/$/, "");

/**
 * LAN/mobile dev hosts for `next dev` (HMR + `/_next/*`).
 * Must include every IP/hostname you open on phone — e.g. both 192.168.1.4 and .38
 * if DHCP changes. Comma-separate in ALLOWED_DEV_ORIGINS (.env.local).
 */
function getAllowedDevOrigins(): string[] {
  const origins = new Set<string>(["localhost", "127.0.0.1"]);

  const raw =
    process.env.ALLOWED_DEV_ORIGINS?.trim() ??
    readEnvLocalValue("ALLOWED_DEV_ORIGINS")?.trim() ??
    "";

  for (const entry of raw.split(",")) {
    const host = parseDevOriginHost(entry);
    if (host) {
      origins.add(host);
    }
  }

  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        origins.add(iface.address);
      }
    }
  }

  return [...origins];
}

const allowedDevOrigins = getAllowedDevOrigins();

const isProd = process.env.NODE_ENV === "production";

/**
 * Production API origin used in CSP connect-src.
 * Falls back to same-origin proxy pattern when not set.
 */
const apiPublicOrigin = process.env.NEXT_PUBLIC_API_BASE_URL
  ? new URL(process.env.NEXT_PUBLIC_API_BASE_URL).origin
  : "";

/**
 * Security headers applied to every route in production.
 *
 * CSP policy:
 *  - No unsafe-eval (blocks code injection via eval)
 *  - script-src: self + Razorpay checkout script
 *  - frame-src: self + Razorpay checkout iframe
 *  - connect-src: self + API origin + Razorpay
 *  - img-src: self + https (CDN images) + data: (base64 previews) + blob: (canvas/object URLs)
 *  - style-src: self + unsafe-inline (required by Tailwind runtime in some configs)
 *
 * Adjust connect-src when adding analytics or other third-party APIs.
 */
function buildSecurityHeaders(): Array<{ key: string; value: string }> {
  const connectSrc = [
    "'self'",
    apiPublicOrigin || "'self'",
    "https://api.razorpay.com",
    "https://lumberjack.razorpay.com",
    "https://cloudflareinsights.com",
  ]
    .filter(Boolean)
    .join(" ");

  const csp = [
    "default-src 'self'",
    `connect-src ${connectSrc}`,
    "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com https://cdn.razorpay.com https://static.cloudflareinsights.com https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "font-src 'self' data:",
    "frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    // Prevent clickjacking
    { key: "X-Frame-Options", value: "DENY" },
    // Prevent MIME-type sniffing
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Control referrer information
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Limit browser feature access
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(self https://checkout.razorpay.com)",
    },
    // HSTS — only in production; 1 year + includeSubDomains
    ...(isProd
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ]
      : []),
    // Cross-origin isolation (required for SharedArrayBuffer, improves isolation)
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ];
}

const nextConfig: NextConfig = {
  allowedDevOrigins,
  turbopack: {
    root: frontendRoot,
  },
  experimental: {
    // Client-side Router Cache TTLs. Default kept deactivated products (and any
    // other admin change) visible on the storefront during client navigation —
    // visited/prefetched pages replayed stale RSC payloads until a hard refresh.
    // dynamic: 0 → every client-side navigation refetches the page from the
    // server (all product surfaces render fresh, server fetches are no-store);
    // static: 60 → prefetched static shells stay snappy for a minute.
    staleTimes: {
      dynamic: 0,
      static: 60,
    },
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendProxyOrigin}/api/v1/:path*`,
      },
    ];
  },
  async headers() {
    const securityHeaders = buildSecurityHeaders();
    return [
      {
        // Apply to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // Static assets: allow cross-origin reads (fonts, scripts, CSS)
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
      },
      ...allowedDevOrigins
        .filter((host) => host !== "localhost" && host !== "127.0.0.1")
        .map((hostname) => ({
          protocol: "http" as const,
          hostname,
        })),
    ],
  },
};

export default nextConfig;
