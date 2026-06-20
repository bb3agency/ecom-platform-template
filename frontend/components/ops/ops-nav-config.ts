import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Gauge,
  Layers,
  LayoutDashboard,
  MailPlus,
  ScrollText,
  ServerCog,
  Settings,
  Shield,
  Users,
} from "lucide-react";

export interface OpsNavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const OPS_NAV_ITEMS: OpsNavItem[] = [
  {
    href: "/ops",
    label: "Overview",
    description: "Session, readiness, and quick actions",
    icon: LayoutDashboard,
  },
  {
    href: "/ops/load-shed",
    label: "Load shed",
    description: "Traffic protection modes",
    icon: Gauge,
  },
  {
    href: "/ops/config",
    label: "Configuration",
    description: "Runtime keys and DB overlay",
    icon: Settings,
  },
  {
    href: "/ops/audit",
    label: "Audit log",
    description: "Tamper-evident activity timeline",
    icon: ScrollText,
  },
  {
    href: "/ops/invites",
    label: "Invites",
    description: "Onboard new operators",
    icon: MailPlus,
  },
  {
    href: "/ops/users",
    label: "Operators",
    description: "Active ops accounts",
    icon: Users,
  },
  {
    href: "/ops/admin-users",
    label: "Merchant admins",
    description: "Merchant admin accounts",
    icon: Shield,
  },
  {
    href: "/ops/queues",
    label: "Queues",
    description: "Bull Board and dead letters",
    icon: Layers,
  },
  {
    href: "/ops/system",
    label: "System",
    description: "Controlled restarts",
    icon: ServerCog,
  },
  {
    href: "/ops/metrics",
    label: "Metrics",
    description: "Prometheus snapshot",
    icon: Activity,
  },
];

export function isOpsNavActive(pathname: string, href: string): boolean {
  if (href === "/ops") {
    return pathname === "/ops";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
