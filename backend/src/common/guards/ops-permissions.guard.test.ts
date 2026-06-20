import { describe, expect, it } from 'vitest';
import { AppError } from '@common/errors/app-error';
import { opsPermissionGuard } from './ops-permissions.guard';

type OpsGuard = ReturnType<typeof opsPermissionGuard>;
type OpsGuardRequest = Parameters<OpsGuard>[0];
type OpsGuardReply = Parameters<OpsGuard>[1];

describe('opsPermissionGuard', () => {
  it('allows ops user with required permission', async () => {
    const guard = opsPermissionGuard('ops:read');
    const request = {
      method: 'GET',
      opsUser: {
        id: 'ops_1',
        email: 'ops@example.com',
        name: 'Ops One',
        permissions: ['OPS_READ']
      }
    } as unknown as OpsGuardRequest;

    await expect(guard(request, {} as unknown as OpsGuardReply)).resolves.toBeUndefined();
    expect(request.opsControlDecision).toEqual({
      permission: 'ops:read'
    });
  });

  it('sets opsControlDecision correctly for ops:write', async () => {
    const guard = opsPermissionGuard('ops:write');
    const request = {
      method: 'POST',
      opsUser: {
        id: 'ops_1',
        email: 'ops@example.com',
        name: 'Ops One',
        permissions: ['OPS_WRITE']
      }
    } as unknown as OpsGuardRequest;

    await expect(guard(request, {} as unknown as OpsGuardReply)).resolves.toBeUndefined();
    expect(request.opsControlDecision).toEqual({
      permission: 'ops:write'
    });
  });

  it('rejects when permission is missing', async () => {
    const guard = opsPermissionGuard('ops:write');
    const request = {
      method: 'POST',
      opsUser: {
        id: 'ops_1',
        email: 'ops@example.com',
        name: 'Ops One',
        permissions: ['OPS_READ']
      }
    } as unknown as OpsGuardRequest;

    await expect(guard(request, {} as unknown as OpsGuardReply)).rejects.toBeInstanceOf(AppError);
  });
});
