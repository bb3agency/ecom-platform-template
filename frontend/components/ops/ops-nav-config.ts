import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Gauge,
  Layers,
  LayoutDashboard,
  MailPlus,
  ScrollText,
  ServerCog,
  Settings2,
  Store,
  Users,
} from "lucide-react";

export interface OpsNavItem {
  href: string;
  label: string;
  /** Shorter label for the phone tab bar. */
  shortLabel?: string;
  icon: LucideIcon;
}

export interface OpsNavGroup {
  label: string;
  items: OpsNavItem[];
}

const overview: OpsNavItem = { href: "/ops", label: "Overview", icon: LayoutDashboard };
const traffic: OpsNavItem = { href: "/ops/load-shed", label: "Traffic mode", shortLabel: "Traffic", icon: Gauge };
const config: OpsNavItem = { href: "/ops/config", label: "Configuration", shortLabel: "Config", icon: Settings2 };
const audit: OpsNavItem = { href: "/ops/audit", label: "Audit log", shortLabel: "Audit", icon: ScrollText };
const queues: OpsNavItem = { href: "/ops/queues", label: "Queues", icon: Layers };
const system: OpsNavItem = { href: "/ops/system", label: "Restart", icon: ServerCog };
const metrics: OpsNavItem = { href: "/ops/metrics", label: "Metrics", icon: Activity };
const operators: OpsNavItem = { href: "/ops/users", label: "Operators", icon: Users };
const admins: OpsNavItem = { href: "/ops/admin-users", label: "Merchant admins", icon: Store };
const invites: OpsNavItem = { href: "/ops/invites", label: "Invites", icon: MailPlus };

/** Sidebar and "More" sheet, grouped by job. */
export const OPS_NAV_GROUPS: OpsNavGroup[] = [
  { label: "Platform", items: [overview, traffic, config, queues, system, metrics] },
  { label: "Activity", items: [audit] },
  { label: "Access", items: [operators, admins, invites] },
];

/** The four most-used destinations, pinned to the phone tab bar. */
export const OPS_TAB_ITEMS: OpsNavItem[] = [overview, traffic, config, audit];

export const OPS_NAV_ITEMS: OpsNavItem[] = OPS_NAV_GROUPS.flatMap((group) => group.items);

export function isOpsNavActive(pathname: string, href: string): boolean {
  if (href === "/ops") {
    return pathname === "/ops";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
