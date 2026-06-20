import { describe, expect, it } from 'vitest';
import { resolveAdminDutyRole, resolveAdminPermissions } from './admin-permissions';

type ResolveAdminPermissionsPrisma = Parameters<typeof resolveAdminPermissions>[0];

describe('admin permissions resolution', () => {
  it('uses DB permission grants when available', async () => {
    const prisma = {
      adminPermissionGrant: {
        findMany: async () => [
          { permission: 'orders:read' },
          { permission: 'orders:refund' },
          { permission: 'invalid:permission' }
        ]
      }
    } as unknown as ResolveAdminPermissionsPrisma;

    const resolved = await resolveAdminPermissions(prisma, 'admin_1');
    expect(resolved).toEqual(['orders:read', 'orders:refund']);
  });

  it('fails closed when DB permission grants are absent', async () => {
    const prisma = {
      adminPermissionGrant: {
        findMany: async () => []
      }
    } as unknown as ResolveAdminPermissionsPrisma;

    const resolved = await resolveAdminPermissions(prisma, 'admin_1');
    expect(resolved).toEqual([]);
  });

  it('maps legacy role scopes to canonical merchant/developer scope hints', async () => {
    const prisma = {
      adminPermissionGrant: {
        findMany: async () => [
          { permission: 'orders:read' },
          { permission: 'merchant:superadmin:*' },
          { permission: 'platform:ops:*' }
        ]
      }
    } as unknown as ResolveAdminPermissionsPrisma;

    const resolved = await resolveAdminPermissions(prisma, 'admin_2');
    expect(resolved).toContain('merchant:*');
    expect(resolved).toContain('developer:*');
  });

  it('resolves canonical duty role from compatibility grants', () => {
    expect(resolveAdminDutyRole(['merchant:ops:*'])).toBe('merchant');
    expect(resolveAdminDutyRole(['merchant:superadmin:*'])).toBe('merchant');
    expect(resolveAdminDutyRole(['platform:ops:*'])).toBe('developer');
    expect(resolveAdminDutyRole(['security:auditor:*'])).toBe('developer');
    expect(resolveAdminDutyRole(['ops:write'])).toBe('developer');
  });
});
