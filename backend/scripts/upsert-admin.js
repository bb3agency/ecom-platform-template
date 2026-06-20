const { PrismaClient, Role } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
  const prisma = new PrismaClient();
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@12345';
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: Role.ADMIN,
      firstName: 'System',
      lastName: 'Admin',
      isVerified: true,
      phone: process.env.SEED_ADMIN_PHONE || '9000000000'
    },
    create: {
      email,
      passwordHash,
      firstName: 'System',
      lastName: 'Admin',
      role: Role.ADMIN,
      isVerified: true,
      phone: process.env.SEED_ADMIN_PHONE || '9000000000'
    }
  });

  // Grant every known permission so the CI admin passes all adminPermissionGuard checks.
  // The wildcard '*' is NOT recognised by resolveAdminPermissions (filtered by isAdminPermission),
  // so we must create individual grants. Include 'developer:*' for Layer C operations.
  const allPermissions = [
    'products:read', 'products:write',
    'categories:read', 'categories:write',
    'inventory:read', 'inventory:write',
    'coupons:read', 'coupons:write',
    'settings:read', 'settings:write',
    'reviews:read', 'reviews:moderate',
    'dashboard:read',
    'analytics:read', 'analytics:export', 'analytics:replay',
    'orders:read', 'orders:write', 'orders:export', 'orders:refund', 'orders:notify',
    'users:read', 'users:write',
    'shipments:read', 'payments:read',
    'ops:read', 'ops:write',
    'developer:*'
  ];

  for (const permission of allPermissions) {
    await prisma.adminPermissionGrant.upsert({
      where: {
        userId_permission: { userId: user.id, permission }
      },
      update: {},
      create: {
        userId: user.id,
        permission
      }
    });
  }

  await prisma.$disconnect();
  process.stdout.write(user.id);
}

main().catch((error) => {
  process.stderr.write(String(error));
  process.exit(1);
});
