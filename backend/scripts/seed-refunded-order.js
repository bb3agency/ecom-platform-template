const { PrismaClient, OrderStatus, PaymentProvider, PaymentStatus, Role } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const CREDIT_NOTE_PREFIX = 'CREDIT_NOTE|';

function makeUniqueToken() {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash('Fixture@12345', 12);
    const fixtureUser = await prisma.user.upsert({
      where: { email: 'fixture.refunded@example.com' },
      update: {
        firstName: 'Refunded',
        lastName: 'Fixture',
        role: Role.CUSTOMER,
        isVerified: true,
        passwordHash
      },
      create: {
        email: 'fixture.refunded@example.com',
        phone: `90000${String(Math.floor(Math.random() * 99999)).padStart(5, '0')}`,
        firstName: 'Refunded',
        lastName: 'Fixture',
        role: Role.CUSTOMER,
        isVerified: true,
        passwordHash
      }
    });

    const existingOrder = await prisma.order.findFirst({
      where: {
        userId: fixtureUser.id,
        status: OrderStatus.REFUNDED,
        statusHistory: {
          some: {
            note: {
              startsWith: CREDIT_NOTE_PREFIX
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    if (existingOrder) {
      process.stdout.write(`existing_refunded_order_id=${existingOrder.id}\n`);
      return;
    }

    const category = await prisma.category.upsert({
      where: { slug: 'fixture-refunded-category' },
      update: { name: 'Fixture Refunded Category', isActive: true },
      create: { name: 'Fixture Refunded Category', slug: 'fixture-refunded-category', isActive: true }
    });

    const product = await prisma.product.upsert({
      where: { slug: 'fixture-refunded-product' },
      update: {
        name: 'Fixture Refunded Product',
        description: 'Deterministic refunded-order fixture product',
        categoryId: category.id,
        tags: ['fixture', 'refunded'],
        isActive: true
      },
      create: {
        name: 'Fixture Refunded Product',
        slug: 'fixture-refunded-product',
        description: 'Deterministic refunded-order fixture product',
        categoryId: category.id,
        tags: ['fixture', 'refunded'],
        isActive: true
      }
    });

    const variant = await prisma.productVariant.upsert({
      where: { sku: 'FIXTURE-REFUND-001' },
      update: { productId: product.id, name: 'Default', price: 10000, isActive: true, weight: 500 },
      create: {
        productId: product.id,
        sku: 'FIXTURE-REFUND-001',
        name: 'Default',
        price: 10000,
        isActive: true,
        weight: 500
      }
    });

    await prisma.inventory.upsert({
      where: { variantId: variant.id },
      update: { quantity: 50, lowStockThreshold: 5 },
      create: { variantId: variant.id, quantity: 50, lowStockThreshold: 5 }
    });

    const token = makeUniqueToken();
    const orderNumber = `ORD-FIX-${token}`;
    const providerOrderId = `fixture_order_${token}`;
    const providerPaymentId = `fixture_payment_${token}`;
    const invoiceNumber = `FIX-INV-${token}`;
    const creditNoteNumber = `CN-${token}`;
    const notePayload = {
      creditNoteNumber,
      originalInvoiceNumber: invoiceNumber,
      reason: 'Fixture refund for contract validation'
    };

    const createdOrder = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          orderNumber,
          userId: fixtureUser.id,
          status: OrderStatus.REFUNDED,
          shippingAddress: {
            fullName: 'Refunded Fixture',
            phone: '9000000000',
            line1: 'Fixture Street 1',
            line2: null,
            city: 'Hyderabad',
            state: 'Telangana',
            pincode: '500001'
          },
          subtotal: 10000,
          shippingCharge: 0,
          discountAmount: 0,
          total: 10000
        }
      });

      await tx.orderItem.create({
        data: {
          orderId: order.id,
          variantId: variant.id,
          productName: 'Fixture Refunded Product',
          variantName: 'Default',
          sku: 'FIXTURE-REFUND-001',
          quantity: 1,
          unitPrice: 10000,
          totalPrice: 10000
        }
      });

      await tx.payment.create({
        data: {
          orderId: order.id,
          provider: PaymentProvider.RAZORPAY,
          providerOrderId,
          providerPaymentId,
          amount: 10000,
          status: PaymentStatus.REFUNDED,
          method: 'upi'
        }
      });

      await tx.invoice.create({
        data: {
          orderId: order.id,
          invoiceNumber,
          pdfUrl: `https://example.com/fixtures/${invoiceNumber}.pdf`
        }
      });

      await tx.orderStatusHistory.createMany({
        data: [
          { orderId: order.id, fromStatus: null, toStatus: OrderStatus.PENDING_PAYMENT, note: 'Fixture order created' },
          { orderId: order.id, fromStatus: OrderStatus.PENDING_PAYMENT, toStatus: OrderStatus.CONFIRMED, note: 'Fixture payment captured' },
          { orderId: order.id, fromStatus: OrderStatus.CONFIRMED, toStatus: OrderStatus.CANCELLED, note: 'Fixture cancellation' },
          {
            orderId: order.id,
            fromStatus: OrderStatus.CANCELLED,
            toStatus: OrderStatus.REFUNDED,
            note: `${CREDIT_NOTE_PREFIX}${JSON.stringify(notePayload)}`
          }
        ]
      });

      return order;
    });

    process.stdout.write(`created_refunded_order_id=${createdOrder.id}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
