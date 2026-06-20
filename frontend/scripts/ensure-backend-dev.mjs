/**
 * Runs before `npm run dev`. Fails fast when the Fastify API is not reachable so
 * Next.js does not start with a broken `/api/v1/*` proxy (ECONNREFUSED spam).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envLocalPath = path.join(frontendRoot, ".env.local");

function readBackendOrigin() {
  const fromProcess =
    process.env.BACKEND_PROXY_URL?.trim() ||
    process.env.INTERNAL_API_BASE_URL?.replace(/\/api\/v1\/?$/, "")?.trim();

  if (fromProcess) {
    return fromProcess.replace(/\/$/, "");
  }

  if (fs.existsSync(envLocalPath)) {
    const content = fs.readFileSync(envLocalPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^BACKEND_PROXY_URL=(.+)$/);
      if (match) {
        return match[1].trim().replace(/^["']|["']$/g, "").replace(/\/$/, "");
      }
    }
  }

  return "http://127.0.0.1:3000";
}

async function isBackendReachable(origin) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(`${origin}/api/v1/health/live`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

const backendOrigin = readBackendOrigin();

if (!(await isBackendReachable(backendOrigin))) {
  console.error("");
  console.error("Frontend dev requires the Fastify API to be running.");
  console.error(`Could not reach ${backendOrigin}/api/v1/health/live`);
  console.error("");
  console.error("Start the backend in another terminal, then retry:");
  console.error("  cd backend");
  console.error("  npm run dev");
  console.error("");
  console.error("Or use the full Windows bootstrap (Docker + Prisma + server):");
  console.error("  cd backend");
  console.error("  scripts\\dev-up.cmd");
  console.error("");
  process.exit(1);
}

console.log(`Backend OK at ${backendOrigin}`);

const lanHosts = [];
for (const interfaces of Object.values(os.networkInterfaces())) {
  for (const iface of interfaces ?? []) {
    if (iface.family === "IPv4" && !iface.internal) {
      lanHosts.push(iface.address);
    }
  }
}

if (lanHosts.length > 0) {
  console.log("");
  console.log("Mobile/LAN dev: open admin using the Network URL from `next dev`.");
  console.log(
    "If your phone uses a different IP (e.g. after DHCP change), add to frontend/.env.local:",
  );
  console.log(`  ALLOWED_DEV_ORIGINS=${lanHosts.join(",")}`);
  console.log("Then restart `npm run dev`.");
  console.log("");
}
