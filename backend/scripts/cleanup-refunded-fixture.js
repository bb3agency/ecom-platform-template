const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    const fixtureUser = await prisma.user.findUnique({
      where: { email: 'fixture.refunded@example.com' },
      select: { id: true }
    });

    if (!fixtureUser) {
      process.stdout.write('fixture_user_absent\n');
      return;
    }

    const fixtureOrders = await prisma.order.findMany({
      where: {
        userId: fixtureUser.id,
        orderNumber: { startsWith: 'ORD-FIX-' }
      },
      select: { id: true }
    });

    if (fixtureOrders.length === 0) {
      process.stdout.write('fixture_orders_absent\n');
      return;
    }

    const orderIds = fixtureOrders.map((order) => order.id);

    await prisma.$transaction(async (tx) => {
      await tx.shipmentEvent.deleteMany({
        where: {
          shipment: {
            orderId: { in: orderIds }
          }
        }
      });

      await tx.shipment.deleteMany({
        where: { orderId: { in: orderIds } }
      });

      await tx.orderStatusHistory.deleteMany({
        where: { orderId: { in: orderIds } }
      });

      await tx.orderItem.deleteMany({
        where: { orderId: { in: orderIds } }
      });

      await tx.payment.deleteMany({
        where: { orderId: { in: orderIds } }
      });

      await tx.invoice.deleteMany({
        where: { orderId: { in: orderIds } }
      });

      await tx.order.deleteMany({
        where: { id: { in: orderIds } }
      });
    });

    process.stdout.write(`deleted_fixture_orders=${orderIds.length}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
