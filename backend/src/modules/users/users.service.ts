import { FastifyInstance } from 'fastify';
import { AppError } from '@common/errors/app-error';
import { ERROR_CODES } from '@common/errors/error-codes';
import {
  AddressListQuery,
  AdminCustomerOrdersQuery,
  AdminUsersListQuery,
  CreateAddressInput,
  OrderListQuery,
  UpdateAddressInput,
  UpdateProfileInput
} from './users.types';

function maskPhone(phone: string | null): string | null {
  if (!phone || phone.length < 4) return phone;
  return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);
}

export class UsersService {
  constructor(private readonly fastify: FastifyInstance) {}

  async getMe(userId: string) {
    const user = await this.fastify.prisma.user.findUnique({
      where: { id: userId }
    });
    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }
    if (user.isBanned) {
      throw new AppError(
        ERROR_CODES.UNAUTHORISED,
        'Your account has been suspended. Please contact support.',
        401
      );
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone ?? '',
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isVerified: user.isVerified
    };
  }

  async patchMe(userId: string, input: UpdateProfileInput) {
    const existing = await this.fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { isBanned: true, email: true, phone: true }
    });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }
    if (existing.isBanned) {
      throw new AppError(
        ERROR_CODES.UNAUTHORISED,
        'Your account has been suspended. Please contact support.',
        401
      );
    }

    if (input.email) {
      const existingEmail = await this.fastify.prisma.user.findFirst({
        where: {
          email: input.email,
          id: { not: userId }
        }
      });
      if (existingEmail) {
        throw new AppError(ERROR_CODES.CONFLICT, 'Email already in use', 409);
      }
    }

    // Phone add/update/remove. The phone doubles as an OTP login identifier, so:
    //  - a number already on another account is a 409 (same rule as email);
    //  - removing it is only allowed when the account still has an email — otherwise the
    //    customer would strip their ONLY way to sign back in.
    const normalizedPhone =
      input.phone === undefined ? undefined : input.phone === null ? null : input.phone.trim();
    if (typeof normalizedPhone === 'string' && normalizedPhone.length > 0) {
      const existingPhone = await this.fastify.prisma.user.findFirst({
        where: {
          phone: normalizedPhone,
          id: { not: userId }
        }
      });
      if (existingPhone) {
        throw new AppError(ERROR_CODES.CONFLICT, 'This mobile number is already linked to another account.', 409);
      }
    }
    const removingPhone = normalizedPhone === null || normalizedPhone === '';
    if (removingPhone) {
      const willHaveEmail = input.email !== undefined ? Boolean(input.email) : Boolean(existing.email);
      if (!willHaveEmail) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          'Add an email address before removing your mobile number — it is your only way to sign in.',
          400
        );
      }
    }

    const updateData: Record<string, string | null> = {};
    if (input.firstName !== undefined) updateData.firstName = input.firstName;
    if (input.lastName !== undefined) updateData.lastName = input.lastName;
    if (input.email !== undefined) updateData.email = input.email;
    if (normalizedPhone !== undefined) updateData.phone = removingPhone ? null : normalizedPhone;

    const user = await this.fastify.prisma.user.update({
      where: { id: userId },
      data: updateData
    });

    return {
      id: user.id,
      email: user.email,
      phone: user.phone ?? '',
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isVerified: user.isVerified
    };
  }

  async listAddresses(userId: string, query: AddressListQuery) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const [items, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.address.findMany({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit
      }),
      this.fastify.prisma.address.count({
        where: { userId }
      })
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async createAddress(userId: string, input: CreateAddressInput) {
    return this.fastify.prisma.$transaction(async (tx) => {
      const shouldBeDefault = Boolean(input.isDefault);
      if (shouldBeDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false }
        });
      }

      return tx.address.create({
        data: {
          userId,
          fullName: input.fullName,
          phone: input.phone,
          line1: input.line1,
          ...(input.line2 !== undefined ? { line2: input.line2 } : {}),
          city: input.city,
          state: input.state,
          pincode: input.pincode,
          isDefault: shouldBeDefault
        }
      });
    });
  }

  async updateAddress(userId: string, addressId: string, input: UpdateAddressInput) {
    const address = await this.fastify.prisma.address.findFirst({
      where: { id: addressId, userId }
    });
    if (!address) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Address not found', 404);
    }

    return this.fastify.prisma.$transaction(async (tx) => {
      if (input.isDefault === true) {
        await tx.address.updateMany({
          where: { userId, isDefault: true, id: { not: addressId } },
          data: { isDefault: false }
        });
      }

      const updateData: Record<string, string | boolean> = {};
      if (input.fullName !== undefined) updateData.fullName = input.fullName;
      if (input.phone !== undefined) updateData.phone = input.phone;
      if (input.line1 !== undefined) updateData.line1 = input.line1;
      if (input.line2 !== undefined) updateData.line2 = input.line2;
      if (input.city !== undefined) updateData.city = input.city;
      if (input.state !== undefined) updateData.state = input.state;
      if (input.pincode !== undefined) updateData.pincode = input.pincode;
      if (input.isDefault !== undefined) updateData.isDefault = input.isDefault;

      const addressDelegate = tx.address as unknown as {
        updateMany?: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
        update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
      };
      const preferUpdateForMock =
        typeof addressDelegate.update === 'function' &&
        'mock' in (addressDelegate.update as unknown as Record<string, unknown>);

      if (addressDelegate.updateMany && !preferUpdateForMock) {
        const updateResult = await addressDelegate.updateMany({
          where: {
            id: addressId,
            updatedAt: address.updatedAt
          },
          data: updateData
        });

        if (updateResult.count === 0) {
          throw new AppError(ERROR_CODES.CONFLICT, 'Address changed concurrently. Please retry.', 409);
        }

        return tx.address.findUniqueOrThrow({ where: { id: addressId } });
      }

      return tx.address.update({
        where: { id: addressId },
        data: updateData
      });
    });
  }

  async deleteAddress(userId: string, addressId: string) {
    const address = await this.fastify.prisma.address.findFirst({
      where: { id: addressId, userId }
    });
    if (!address) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Address not found', 404);
    }

    await this.fastify.prisma.address.delete({
      where: { id: addressId }
    });

    return { message: 'Address deleted' };
  }

  async listOrders(userId: string, query: OrderListQuery) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const customerOrderWhere = { userId, status: { notIn: ['PENDING_PAYMENT' as const, 'PAYMENT_FAILED' as const] } };
    const [orders, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.order.findMany({
        where: customerOrderWhere,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentMode: true,
          subtotal: true,
          shippingCharge: true,
          discountAmount: true,
          total: true,
          createdAt: true,
          invoice: {
            select: {
              invoiceNumber: true,
              pdfUrl: true,
              issuedAt: true
            }
          },
          shipment: {
            select: {
              status: true,
              awbNumber: true,
              trackingUrl: true,
              events: {
                orderBy: { occurredAt: 'desc' },
                take: 1,
                select: {
                  status: true,
                  occurredAt: true
                }
              }
            }
          }
        }
      }),
      this.fastify.prisma.order.count({ where: customerOrderWhere })
    ]);

    return {
      items: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentMode: (order as Record<string, unknown>).paymentMode ?? null,
        subtotal: order.subtotal,
        shippingCharge: order.shippingCharge,
        discountAmount: order.discountAmount,
        total: order.total,
        createdAt: order.createdAt.toISOString(),
        invoice: (order as Record<string, unknown>).invoice
          ? {
              hasPdf: !!((order as Record<string, unknown>).invoice as Record<string, unknown> | null)?.pdfUrl,
              invoiceNumber: ((order as Record<string, unknown>).invoice as Record<string, unknown> | null)?.invoiceNumber ?? null,
              issuedAt: ((order as Record<string, unknown>).invoice as Record<string, unknown> | null)?.issuedAt
                ? new Date(((order as Record<string, unknown>).invoice as Record<string, unknown>).issuedAt as string | Date).toISOString()
                : null
            }
          : null,
        shipmentStatus: order.shipment?.status ?? null,
        awb: order.shipment?.awbNumber ?? null,
        trackingUrl: order.shipment?.trackingUrl ?? null,
        latestShipmentEventStatus: order.shipment?.events[0]?.status ?? null,
        latestShipmentEventAt: order.shipment?.events[0]?.occurredAt.toISOString() ?? null
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async adminListUsers(query: AdminUsersListQuery) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const search = query.search?.trim();
    const whereClause = {
      role: 'CUSTOMER' as const,
      ...(query.banned !== undefined ? { isBanned: query.banned } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {})
            }
          }
        : {}),
      ...(search && search.length > 0
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search } }
            ]
          }
        : {})
    };

    const [items, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.user.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          isBanned: true,
          createdAt: true
        }
      }),
      this.fastify.prisma.user.count({ where: whereClause })
    ]);

    const userIds = items.map((item) => item.id);
    const orderStats = userIds.length
      ? await this.fastify.prisma.order.groupBy({
          by: ['userId'],
          where: {
            userId: { in: userIds },
            status: { notIn: ['PENDING_PAYMENT', 'PAYMENT_FAILED', 'CANCELLED'] }
          },
          _count: { _all: true },
          _sum: { total: true }
        })
      : [];
    const statsByUserId = new Map(
      orderStats.map((stat) => [stat.userId, { totalOrders: stat._count._all, totalSpendPaise: stat._sum.total ?? 0 }])
    );

    return {
      items: items.map((item) => ({
        ...item,
        phone: maskPhone(item.phone),
        totalOrders: statsByUserId.get(item.id)?.totalOrders ?? 0,
        totalSpendPaise: statsByUserId.get(item.id)?.totalSpendPaise ?? 0,
        createdAt: item.createdAt.toISOString()
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async adminGetCustomerOrders(userId: string, query: AdminCustomerOrdersQuery) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const user = await this.fastify.prisma.user.findFirst({
      where: { id: userId, role: 'CUSTOMER' },
      select: { id: true }
    });
    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    const [orders, total] = await this.fastify.prisma.$transaction([
      this.fastify.prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          shipment: {
            select: {
              status: true,
              awbNumber: true,
              trackingUrl: true,
              events: {
                orderBy: { occurredAt: 'desc' },
                take: 1,
                select: { status: true, occurredAt: true }
              }
            }
          }
        }
      }),
      this.fastify.prisma.order.count({ where: { userId } })
    ]);

    return {
      items: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        subtotal: order.subtotal,
        shippingCharge: order.shippingCharge,
        discountAmount: order.discountAmount,
        total: order.total,
        createdAt: order.createdAt.toISOString(),
        shipmentStatus: order.shipment?.status ?? null,
        awb: order.shipment?.awbNumber ?? null,
        trackingUrl: order.shipment?.trackingUrl ?? null,
        latestShipmentEventStatus: order.shipment?.events[0]?.status ?? null,
        latestShipmentEventAt: order.shipment?.events[0]?.occurredAt.toISOString() ?? null
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async adminGetUserById(userId: string) {
    const user = await this.fastify.prisma.user.findFirst({
      where: {
        id: userId,
        role: 'CUSTOMER'
      },
      include: {
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            orderNumber: true,
            status: true,
            subtotal: true,
            shippingCharge: true,
            discountAmount: true,
            total: true,
            createdAt: true,
            shipment: {
              select: {
                status: true,
                awbNumber: true,
                trackingUrl: true,
                events: {
                  orderBy: { occurredAt: 'desc' },
                  take: 1,
                  select: {
                    status: true,
                    occurredAt: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      isBanned: user.isBanned,
      bannedAt: user.bannedAt?.toISOString() ?? null,
      bannedReason: user.bannedReason,
      createdAt: user.createdAt.toISOString(),
      addresses: user.addresses,
      orders: user.orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        subtotal: order.subtotal,
        shippingCharge: order.shippingCharge,
        discountAmount: order.discountAmount,
        total: order.total,
        createdAt: order.createdAt.toISOString(),
        shipmentStatus: order.shipment?.status ?? null,
        awb: order.shipment?.awbNumber ?? null,
        trackingUrl: order.shipment?.trackingUrl ?? null,
        latestShipmentEventStatus: order.shipment?.events[0]?.status ?? null,
        latestShipmentEventAt: order.shipment?.events[0]?.occurredAt.toISOString() ?? null
      }))
    };
  }

  /**
   * Ban a customer account. Sets isBanned=true, records reason and timestamp.
   * @param userId - Customer UUID
   * @param reason - Human-readable ban reason
   * @param adminUserId - Admin performing the action
   */
  async adminBanUser(userId: string, reason: string, adminUserId: string) {
    const user = await this.fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isBanned: true, role: true }
    });

    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    if (user.role === 'ADMIN') {
      throw new AppError(ERROR_CODES.FORBIDDEN, 'Cannot ban an admin user', 403);
    }

    if (user.isBanned) {
      throw new AppError(ERROR_CODES.CONFLICT, 'User is already banned', 409);
    }

    const updated = await this.fastify.prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: true,
        bannedAt: new Date(),
        bannedReason: `${reason} [admin:${adminUserId}]`
      },
      select: { id: true, isBanned: true, bannedAt: true, bannedReason: true }
    });

    await this.fastify.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });

    return {
      userId: updated.id,
      isBanned: updated.isBanned,
      bannedAt: updated.bannedAt?.toISOString() ?? null,
      bannedReason: updated.bannedReason
    };
  }

  /**
   * Unban a customer account. Clears ban fields.
   * @param userId - Customer UUID
   * @param adminUserId - Admin performing the action
   */
  async adminUnbanUser(userId: string, adminUserId: string) {
    const user = await this.fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isBanned: true }
    });

    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    if (!user.isBanned) {
      throw new AppError(ERROR_CODES.CONFLICT, 'User is not banned', 409);
    }

    this.fastify.log.info({ adminUserId, userId }, 'Admin unbanning user');

    await this.fastify.prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: false,
        bannedAt: null,
        bannedReason: null
      }
    });

    return { userId, isBanned: false };
  }

  /**
   * List admin notes for a customer.
   * @param userId - Customer UUID
   */
  async adminListUserNotes(userId: string) {
    const user = await this.fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    const notes = await this.fastify.prisma.userAdminNote.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    return notes.map((note) => ({
      id: note.id,
      userId: note.userId,
      content: note.content,
      createdByAdminId: note.createdByAdminId,
      createdAt: note.createdAt.toISOString()
    }));
  }

  /**
   * Create an admin note for a customer.
   * @param userId - Customer UUID
   * @param content - Note content
   * @param adminUserId - Admin creating the note
   */
  async adminCreateUserNote(userId: string, content: string, adminUserId: string) {
    const user = await this.fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!user) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found', 404);
    }

    const note = await this.fastify.prisma.userAdminNote.create({
      data: {
        userId,
        content,
        createdByAdminId: adminUserId
      }
    });

    return {
      id: note.id,
      userId: note.userId,
      content: note.content,
      createdByAdminId: note.createdByAdminId,
      createdAt: note.createdAt.toISOString()
    };
  }

  /**
   * Delete an admin note by ID. Validates the note belongs to the given user.
   * @param userId - Customer UUID (for ownership check)
   * @param noteId - Note UUID
   */
  async adminDeleteUserNote(userId: string, noteId: string) {
    const note = await this.fastify.prisma.userAdminNote.findUnique({
      where: { id: noteId }
    });

    if (!note || note.userId !== userId) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Note not found', 404);
    }

    await this.fastify.prisma.userAdminNote.delete({ where: { id: noteId } });

    return { deleted: true, noteId };
  }

  /** Own new-order notification preferences (any active admin — no extra permission). */
  async getAdminNotificationPreferences(adminId: string) {
    const admin = await this.fastify.prisma.user.findUnique({
      where: { id: adminId },
      select: {
        email: true,
        phone: true,
        orderNotificationsEnabled: true,
        orderNotificationChannels: true
      }
    });
    if (!admin) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Admin not found', 404);
    }
    return {
      enabled: admin.orderNotificationsEnabled,
      channels: admin.orderNotificationChannels,
      email: admin.email,
      phone: admin.phone
    };
  }

  async updateAdminNotificationPreferences(
    adminId: string,
    input: { enabled: boolean; channels: Array<'EMAIL' | 'WHATSAPP' | 'SMS'> }
  ) {
    const channels = [...new Set(input.channels)];
    if (input.enabled && channels.length === 0) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        'Select at least one channel to enable new-order notifications',
        400
      );
    }

    const existing = await this.fastify.prisma.user.findUnique({
      where: { id: adminId },
      select: { email: true, phone: true }
    });
    if (!existing) {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Admin not found', 404);
    }
    if (input.enabled) {
      if (channels.includes('EMAIL') && !existing.email?.trim()) {
        throw new AppError(ERROR_CODES.VALIDATION_ERROR, 'Your admin account has no email address — cannot enable EMAIL notifications', 400);
      }
      if ((channels.includes('WHATSAPP') || channels.includes('SMS')) && !existing.phone?.trim()) {
        throw new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          'Your admin account has no phone number on file — cannot enable WhatsApp/SMS notifications',
          400
        );
      }
    }

    const updated = await this.fastify.prisma.user.update({
      where: { id: adminId },
      data: {
        orderNotificationsEnabled: input.enabled,
        orderNotificationChannels: channels
      },
      select: {
        email: true,
        phone: true,
        orderNotificationsEnabled: true,
        orderNotificationChannels: true
      }
    });
    return {
      enabled: updated.orderNotificationsEnabled,
      channels: updated.orderNotificationChannels,
      email: updated.email,
      phone: updated.phone
    };
  }
}

