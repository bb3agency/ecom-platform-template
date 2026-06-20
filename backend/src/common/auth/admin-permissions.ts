import { PrismaClient } from '@prisma/client';

export const ADMIN_DUTY_ROLES = [
  'merchant',
  'developer'
] as const;
export type AdminDutyRole = (typeof ADMIN_DUTY_ROLES)[number];

export const CONTROL_LAYERS = ['A', 'B', 'C'] as const;
export type ControlLayer = (typeof CONTROL_LAYERS)[number];

export const ADMIN_PERMISSIONS = [
  'products:read',
  'products:write',
  'categories:read',
  'categories:write',
  'inventory:read',
  'inventory:write',
  'coupons:read',
  'coupons:write',
  'settings:read',
  'settings:write',
  'reviews:read',
  'reviews:moderate',
  'dashboard:read',
  'analytics:read',
  'orders:read',
  'orders:write',
  'orders:export',
  'orders:refund',
  'orders:notify',
  'analytics:export',
  'analytics:replay',
  'users:read',
  'users:write',
  'shipments:read',
  'payments:read',
  'ops:read',
  'ops:write'
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
const ADMIN_PERMISSION_SET = new Set<string>(ADMIN_PERMISSIONS);
export const MERCHANT_DEFAULT_PERMISSIONS: readonly AdminPermission[] = [
  'products:read',
  'products:write',
  'categories:read',
  'categories:write',
  'inventory:read',
  'inventory:write',
  'coupons:read',
  'coupons:write',
  'settings:read',
  'settings:write',
  'reviews:read',
  'reviews:moderate',
  'dashboard:read',
  'analytics:read',
  'orders:read',
  'orders:write',
  'orders:export',
  'orders:notify',
  'analytics:export',
  'users:read',
  'users:write',
  'shipments:read',
  'payments:read'
] as const;

export type AdminControlPolicy = {
  permission: AdminPermission;
  layer: ControlLayer;
  ownerRole: AdminDutyRole;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  requiresApproval: boolean;
};

export const ADMIN_CONTROL_POLICY_REGISTRY: Record<AdminPermission, AdminControlPolicy> = {
  'products:read': {
    permission: 'products:read',
    layer: 'A',
    ownerRole: 'merchant',
    riskLevel: 'low',
    requiresApproval: false
  },
  'products:write': {
    permission: 'products:write',
    layer: 'A',
    ownerRole: 'merchant',
    riskLevel: 'medium',
    requiresApproval: false
  },
  'categories:read': {
    permission: 'categories:read',
    layer: 'A',
    ownerRole: 'merchant',
    riskLevel: 'low',
    requiresApproval: false
  },
  'categories:write': {
    permission: 'categories:write',
    layer: 'A',
    ownerRole: 'merchant',
    riskLevel: 'medium',
    requiresApproval: false
  },
  'inventory:read': { permission: 'inventory:read', layer: 'A', ownerRole: 'merchant', riskLevel: 'low', requiresApproval: false },
  'inventory:write': { permission: 'inventory:write', layer: 'A', ownerRole: 'merchant', riskLevel: 'medium', requiresApproval: false },
  'coupons:read': { permission: 'coupons:read', layer: 'A', ownerRole: 'merchant', riskLevel: 'low', requiresApproval: false },
  'coupons:write': { permission: 'coupons:write', layer: 'A', ownerRole: 'merchant', riskLevel: 'medium', requiresApproval: false },
  'settings:read': { permission: 'settings:read', layer: 'A', ownerRole: 'merchant', riskLevel: 'low', requiresApproval: false },
  'settings:write': { permission: 'settings:write', layer: 'A', ownerRole: 'merchant', riskLevel: 'medium', requiresApproval: false },
  'reviews:read': { permission: 'reviews:read', layer: 'A', ownerRole: 'merchant', riskLevel: 'low', requiresApproval: false },
  'reviews:moderate': { permission: 'reviews:moderate', layer: 'A', ownerRole: 'merchant', riskLevel: 'medium', requiresApproval: false },
  'dashboard:read': { permission: 'dashboard:read', layer: 'A', ownerRole: 'merchant', riskLevel: 'low', requiresApproval: false },
  'analytics:read': { permission: 'analytics:read', layer: 'A', ownerRole: 'merchant', riskLevel: 'low', requiresApproval: false },
  'orders:read': { permission: 'orders:read', layer: 'A', ownerRole: 'merchant', riskLevel: 'low', requiresApproval: false },
  'orders:write': { permission: 'orders:write', layer: 'A', ownerRole: 'merchant', riskLevel: 'medium', requiresApproval: false },
  'orders:export': { permission: 'orders:export', layer: 'A', ownerRole: 'merchant', riskLevel: 'low', requiresApproval: false },
  'orders:refund': { permission: 'orders:refund', layer: 'B', ownerRole: 'merchant', riskLevel: 'high', requiresApproval: true },
  'orders:notify': { permission: 'orders:notify', layer: 'A', ownerRole: 'merchant', riskLevel: 'medium', requiresApproval: false },
  'analytics:export': { permission: 'analytics:export', layer: 'A', ownerRole: 'merchant', riskLevel: 'low', requiresApproval: false },
  'analytics:replay': { permission: 'analytics:replay', layer: 'B', ownerRole: 'merchant', riskLevel: 'high', requiresApproval: true },
  'users:read': { permission: 'users:read', layer: 'A', ownerRole: 'merchant', riskLevel: 'medium', requiresApproval: false },
  'users:write': { permission: 'users:write', layer: 'B', ownerRole: 'merchant', riskLevel: 'high', requiresApproval: true },
  'shipments:read': { permission: 'shipments:read', layer: 'A', ownerRole: 'merchant', riskLevel: 'low', requiresApproval: false },
  'payments:read': { permission: 'payments:read', layer: 'A', ownerRole: 'merchant', riskLevel: 'low', requiresApproval: false },
  'ops:read': { permission: 'ops:read', layer: 'C', ownerRole: 'developer', riskLevel: 'high', requiresApproval: false },
  'ops:write': { permission: 'ops:write', layer: 'C', ownerRole: 'developer', riskLevel: 'critical', requiresApproval: true }
};

const ROLE_SCOPE_HINTS: Record<AdminDutyRole, readonly string[]> = {
  merchant: ['merchant:*'],
  developer: ['developer:*']
};
const LEGACY_SCOPE_TO_CANONICAL_ROLE: Record<string, AdminDutyRole> = {
  'merchant:ops:*': 'merchant',
  'merchant:superadmin:*': 'merchant',
  'platform:ops:*': 'developer',
  'security:auditor:*': 'developer'
};
const ROLE_SCOPE_HINT_VALUES = new Set<string>([
  ...Object.values(ROLE_SCOPE_HINTS).flat(),
  ...Object.keys(LEGACY_SCOPE_TO_CANONICAL_ROLE)
]);

export function isAdminPermission(value: string): value is AdminPermission {
  return ADMIN_PERMISSION_SET.has(value);
}

export function hasAdminPermission(permissions: readonly string[] | undefined, required: AdminPermission): boolean {
  if (!permissions) {
    return false;
  }
  return permissions.includes('*') || permissions.includes(required);
}

export function resolveAdminDutyRole(permissions: readonly string[] | undefined): AdminDutyRole {
  const entries = permissions ?? [];
  if (entries.includes('*') || entries.includes('developer:*') || entries.includes('platform:ops:*') || entries.includes('security:auditor:*')) {
    return 'developer';
  }
  if (entries.includes('merchant:*') || entries.includes('merchant:ops:*') || entries.includes('merchant:superadmin:*')) {
    return 'merchant';
  }
  if (entries.includes('ops:write') || entries.includes('ops:read')) {
    return 'developer';
  }
  return 'merchant';
}

export function hasAdminScope(permissions: readonly string[] | undefined, scope: string): boolean {
  if (!permissions) {
    return false;
  }
  return permissions.includes('*') || permissions.includes(scope);
}

export function resolveAdminControlPolicy(permission: AdminPermission): AdminControlPolicy {
  return ADMIN_CONTROL_POLICY_REGISTRY[permission];
}

export function roleHasOwnershipOrHigher(role: AdminDutyRole, policy: AdminControlPolicy): boolean {
  if (role === 'developer') {
    return true;
  }
  return role === policy.ownerRole;
}

export function resolveRoleScopeHints(role: AdminDutyRole): readonly string[] {
  return ROLE_SCOPE_HINTS[role];
}

export function resolveAdminPermissionsFromEnv(): AdminPermission[] {
  const configured = process.env.ADMIN_DEFAULT_PERMISSIONS?.trim();
  if (!configured) {
    return [...MERCHANT_DEFAULT_PERMISSIONS];
  }

  const requested = configured
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry): entry is AdminPermission => (ADMIN_PERMISSIONS as readonly string[]).includes(entry));

  if (requested.length === 0) {
    return [...MERCHANT_DEFAULT_PERMISSIONS];
  }

  return [...new Set(requested)];
}

// FAIL-CLOSED PROVISIONING NOTE:
// A freshly created admin user (role = ADMIN) with no rows in AdminPermissionGrant will receive
// an empty permission set in their access token.  All admin endpoints protected by
// `hasAdminPermission` / `requireAdminPermission` will return 403 until at least one grant is
// inserted.  This is intentional fail-closed behaviour — administrators must be explicitly granted
// permissions before they can act.
//
// To provision a new admin:
//   1. Insert one or more AdminPermissionGrant rows for the target userId.
//      Example (SQL): INSERT INTO "AdminPermissionGrant" ("id","userId","permission","grantedBy","createdAt")
//                     VALUES (gen_random_uuid(), '<userId>', 'orders:read', '<grantedByUserId>', now());
//   2. The admin must log out and log back in (or wait for their refresh token to expire)
//      so that `resolveAdminPermissions` runs again on the next token issuance.
//   3. Alternatively, call POST /admin/auth/logout to force token revocation immediately.
export async function resolveAdminPermissions(prisma: PrismaClient, userId: string): Promise<string[]> {
  const grants = await prisma.adminPermissionGrant.findMany({
    where: { userId },
    select: { permission: true }
  });
  const scoped = grants
    .map((item: { permission: string }) => item.permission)
    .filter((permission): permission is AdminPermission => isAdminPermission(permission));
  const roleScopes = grants
    .map((item: { permission: string }) => item.permission)
    .filter((permission) => ROLE_SCOPE_HINT_VALUES.has(permission));
  const canonicalRoleScopes = roleScopes.map((scope) => {
    if (scope in LEGACY_SCOPE_TO_CANONICAL_ROLE) {
      return LEGACY_SCOPE_TO_CANONICAL_ROLE[scope];
    }
    if (scope === 'merchant:*') {
      return 'merchant';
    }
    if (scope === 'developer:*') {
      return 'developer';
    }
    return 'merchant';
  });
  const canonicalRoleHints = canonicalRoleScopes.map((role) => `${role}:*`);
  if (scoped.length > 0) {
    return [...new Set([...scoped, ...roleScopes, ...canonicalRoleHints])];
  }
  // Fail closed when grant records are absent. Admin permissions must be explicitly granted.
  return [...new Set([...roleScopes, ...canonicalRoleHints])];
}
