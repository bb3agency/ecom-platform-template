import { afterEach, describe, expect, it } from 'vitest';
import { Role } from '@prisma/client';
import { ADMIN_PERMISSIONS } from '@common/auth/admin-permissions';
import { adminPermissionGuard } from './admin-permissions.guard';
import { AppError } from '@common/errors/app-error';

type AdminGuard = ReturnType<typeof adminPermissionGuard>;
type AdminGuardRequest = Parameters<AdminGuard>[0];
type AdminGuardReply = Parameters<AdminGuard>[1];

describe('adminPermissionGuard', () => {
  afterEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.ADMIN_SCOPE_ENFORCEMENT;
    delete process.env.ALLOW_ADMIN_SCOPE_BYPASS;
  });
  it('allows admin with required permission', async () => {
    const guard = adminPermissionGuard('analytics:replay');
    const request = {
      user: {
        sub: 'admin_1',
        role: Role.ADMIN,
        permissions: ['analytics:replay']
      }
    } as unknown as AdminGuardRequest;

    await expect(guard(request, {} as unknown as AdminGuardReply)).resolves.toBeUndefined();
    expect(request.adminControlDecision?.role).toBe('merchant');
  });

  it('rejects admin without required permission', async () => {
    const guard = adminPermissionGuard('analytics:replay');
    const request = {
      user: {
        sub: 'admin_1',
        role: Role.ADMIN,
        permissions: ['orders:read']
      }
    } as unknown as AdminGuardRequest;

    await expect(guard(request, {} as unknown as AdminGuardReply)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects non-admin users', async () => {
    const guard = adminPermissionGuard('users:read');
    const request = {
      user: {
        sub: 'user_1',
        role: Role.CUSTOMER,
        permissions: ['users:read']
      }
    } as unknown as AdminGuardRequest;

    await expect(guard(request, {} as unknown as AdminGuardReply)).rejects.toBeInstanceOf(AppError);
  });

  it('enforces the complete admin permission matrix', async () => {
    for (const permission of ADMIN_PERMISSIONS) {
      const allowGuard = adminPermissionGuard(permission);
      await expect(
        allowGuard(
          {
            user: {
              sub: 'admin_1',
              role: Role.ADMIN,
              permissions: [permission]
            }
          } as unknown as AdminGuardRequest,
          {} as unknown as AdminGuardReply
        )
      ).resolves.toBeUndefined();

      const denyGuard = adminPermissionGuard(permission);
      await expect(
        denyGuard(
          {
            user: {
              sub: 'admin_1',
              role: Role.ADMIN,
              permissions: []
            }
          } as unknown as AdminGuardRequest,
          {} as unknown as AdminGuardReply
        )
      ).rejects.toBeInstanceOf(AppError);
    }
  });

  it('ignores scope bypass toggle in production profile', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ADMIN_SCOPE_ENFORCEMENT = 'false';
    const guard = adminPermissionGuard('orders:refund');
    await expect(
      guard(
        {
          user: {
            sub: 'admin_1',
            role: Role.ADMIN,
            permissions: []
          }
        } as unknown as AdminGuardRequest,
        {} as unknown as AdminGuardReply
      )
    ).rejects.toBeInstanceOf(AppError);
  });

  it('does not bypass when scope enforcement is false without explicit local bypass flag', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_SCOPE_ENFORCEMENT = 'false';
    delete process.env.ALLOW_ADMIN_SCOPE_BYPASS;
    const guard = adminPermissionGuard('orders:refund');
    await expect(
      guard(
        {
          user: {
            sub: 'admin_1',
            role: Role.ADMIN,
            permissions: []
          }
        } as unknown as AdminGuardRequest,
        {} as unknown as AdminGuardReply
      )
    ).rejects.toBeInstanceOf(AppError);
  });

  it('bypasses only in explicit development mode with explicit bypass flag', async () => {
    process.env.NODE_ENV = 'development';
    process.env.ADMIN_SCOPE_ENFORCEMENT = 'false';
    process.env.ALLOW_ADMIN_SCOPE_BYPASS = 'true';
    const guard = adminPermissionGuard('orders:refund');
    await expect(
      guard(
        {
          user: {
            sub: 'admin_1',
            role: Role.ADMIN,
            permissions: []
          }
        } as unknown as AdminGuardRequest,
        {} as unknown as AdminGuardReply
      )
    ).resolves.toBeUndefined();
  });

  it('blocks layer C mutation for merchant role', async () => {
    const guard = adminPermissionGuard('ops:write');
    const request = {
      method: 'POST',
      user: {
        sub: 'admin_merchant',
        role: Role.ADMIN,
        permissions: ['ops:write', 'merchant:*']
      }
    } as unknown as AdminGuardRequest;
    await expect(guard(request, {} as unknown as AdminGuardReply)).rejects.toBeInstanceOf(AppError);
  });

  it('allows layer C mutation for developer role (including legacy platform scope)', async () => {
    const guard = adminPermissionGuard('ops:write');
    const request = {
      method: 'POST',
      user: {
        sub: 'admin_dev',
        role: Role.ADMIN,
        permissions: ['ops:write', 'platform:ops:*']
      }
    } as unknown as AdminGuardRequest;
    await expect(guard(request, {} as unknown as AdminGuardReply)).resolves.toBeUndefined();
    expect(request.adminControlDecision?.role).toBe('developer');
  });

  it('allows ops write endpoint permission for developer role', async () => {
    const guard = adminPermissionGuard('ops:write');
    const request = {
      method: 'POST',
      user: {
        sub: 'admin_dev_approver',
        role: Role.ADMIN,
        permissions: ['ops:write', 'developer:*']
      }
    } as unknown as AdminGuardRequest;
    await expect(guard(request, {} as unknown as AdminGuardReply)).resolves.toBeUndefined();
    expect(request.adminControlDecision?.role).toBe('developer');
  });

  it('allows any listed permission when guard accepts multiple permissions', async () => {
    const guard = adminPermissionGuard('categories:read', 'products:read');
    await expect(
      guard(
        {
          user: {
            sub: 'admin_1',
            role: Role.ADMIN,
            permissions: ['products:read']
          }
        } as unknown as AdminGuardRequest,
        {} as unknown as AdminGuardReply
      )
    ).resolves.toBeUndefined();
  });
});
