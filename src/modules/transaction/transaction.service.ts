import { PrismaClient } from "../../generated/prisma/client.js";
import { ApiError } from "../../utils/api-error.js";
import {
  CreateTransactionBody,
  UploadPaymentProofBody,
} from "../../types/transaction.js";
import { sendEmail } from "../../lib/mail.js";
import { calculateUserPointBalance } from "../../utils/point.utils.js";

export class TransactionService {
  constructor(private prisma: PrismaClient) {}

  createTransaction = async (
    userId: number,
    eventId: number,
    body: CreateTransactionBody,
  ) => {
    const {
      ticketTypeId,
      quantity,
      voucherCode,
      couponCode,
      pointsToUse = 0,
    } = body;

    // Validate quantity
    if (quantity <= 0) {
      throw new ApiError("Quantity must be greater than 0", 400);
    }

    // Validate points to use
    if (pointsToUse < 0) {
      throw new ApiError("Points to use cannot be negative", 400);
    }

    // Use SQL transaction for atomicity
    const transaction = await this.prisma.$transaction(async (tx) => {
      // 1. Lock ticket type and check availability using Raw SQL for Locking
      // Prisma doesn't support "FOR UPDATE" natively yet
      console.log(`[DEBUG] Locking ticketType ${ticketTypeId}`);
      const ticketTypes = await tx.$queryRaw<any[]>`
        SELECT * FROM "ticket_types"
        WHERE id = ${ticketTypeId}
        FOR UPDATE
      `;
      console.log(`[DEBUG] Locked. Found ${ticketTypes.length} rows`);

      if (!ticketTypes.length) {
        throw new ApiError("Ticket type not found", 404);
      }

      const ticketType: any = ticketTypes[0];

      // Need to fetch event relation separately or assume consistency
      // Since we need eventId validation, let's fetch event with standard query
      // The TicketType is already locked so this read is safe from race conditions on TicketType
      const ticketTypeRelation = await tx.ticketType.findUnique({
        where: { id: ticketTypeId },
        include: { event: true },
      });

      if (!ticketTypeRelation) {
        // Should not happen given above check
        throw new ApiError("Ticket type not found", 404);
      }

      if (ticketTypeRelation.eventId !== eventId) {
        throw new ApiError("Ticket type does not belong to this event", 400);
      }

      if (ticketType.availableSeat < quantity) {
        throw new ApiError("Not enough seats available", 400);
      }

      // 2. Calculate base price
      let subtotal = ticketType.price * quantity;

      // 3. Apply voucher if provided
      let voucherDiscount = 0;
      let voucherId: number | null = null;
      if (voucherCode) {
        const voucher = await tx.voucher.findFirst({
          where: {
            eventId,
            code: voucherCode,
            startDate: { lte: new Date() },
            endDate: { gte: new Date() },
          },
        });

        if (voucher && voucher.usedCount >= voucher.usageLimit) {
          throw new ApiError("Voucher usage limit exceeded", 400);
        }

        if (!voucher) {
          throw new ApiError("Invalid or expired voucher", 400);
        }

        voucherId = voucher.id;
        if (voucher.discountType === "PERCENTAGE") {
          voucherDiscount = Math.floor(
            subtotal * (voucher.discountAmount / 100),
          );
        } else {
          voucherDiscount = Math.min(voucher.discountAmount, subtotal);
        }
      }

      // 4. Apply coupon if provided
      let couponDiscount = 0;
      let couponId: number | null = null;
      if (couponCode) {
        const coupon = await tx.coupon.findFirst({
          where: {
            userId,
            code: couponCode,
            expiredAt: { gte: new Date() },
            isUsed: false,
          },
        });

        if (!coupon) {
          throw new ApiError("Invalid or expired coupon", 400);
        }

        // Check if user is organizer and try to use coupon
        const userWithRole = await tx.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });

        if (userWithRole?.role === "ORGANIZER") {
          throw new ApiError(
            "Referral reward is only available for customers",
            400,
          );
        }

        couponId = coupon.id;
        couponDiscount = Math.min(
          coupon.discountAmount,
          subtotal - voucherDiscount,
        );
      }

      // 5. Check and apply points
      const user = await tx.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new ApiError("User not found", 404);
      }

      // Validate points using FIFO logic (re-calculating for accuracy)
      const availablePoints = await calculateUserPointBalance(
        userId,
        tx as any,
      );

      if (pointsToUse > availablePoints) {
        throw new ApiError(
          `Insufficient valid points. Available: ${availablePoints}`,
          400,
        );
      }

      const pointsToDeduct = Math.min(
        pointsToUse,
        availablePoints,
        subtotal - voucherDiscount - couponDiscount,
      );

      // 6. Calculate final price
      const finalPrice = Math.max(
        0,
        subtotal - voucherDiscount - couponDiscount - pointsToDeduct,
      );

      // 7. Update available seats
      await tx.ticketType.update({
        where: { id: ticketTypeId },
        data: {
          availableSeat: { decrement: quantity },
          sold: { increment: quantity },
        },
      });

      // 8. Update voucher used count if used
      if (voucherId) {
        await tx.voucher.update({
          where: { id: voucherId },
          data: {
            usedCount: { increment: 1 },
          },
        });
      }

      // 9. Mark coupon as used if used
      if (couponId) {
        await tx.coupon.update({
          where: { id: couponId },
          data: {
            isUsed: true,
          },
        });
      }

      // 10. Deduct points if used
      if (pointsToDeduct > 0) {
        await tx.user.update({
          where: { id: userId },
          data: {
            point: { decrement: pointsToDeduct },
          },
        });

        // Record point usage
        await tx.point.create({
          data: {
            userId,
            amount: -pointsToDeduct,
            description: `Used for transaction on event: ${ticketTypeRelation.event.title}`,
            type: "USED",
          },
        });
      }

      // 11. Create transaction
      const expiredAt = new Date();
      expiredAt.setHours(expiredAt.getHours() + 2); // 2 hours from now

      const newTransaction = await tx.transaction.create({
        data: {
          userId,
          eventId,
          ticketTypeId,
          voucherId,
          couponId,
          ticketQty: quantity,
          totalPrice: subtotal,
          pointsUsed: pointsToDeduct,
          finalPrice,
          expiredAt,
          status: "WAITING_PAYMENT",
        },
        include: {
          event: {
            include: {
              organizer: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      avatar: true,
                    },
                  },
                },
              },
            },
          },
          ticketType: true,
          voucher: true,
          coupon: true,
        },
      });

      return newTransaction;
    });

    return transaction;
  };

  uploadPaymentProof = async (
    transactionId: number,
    userId: number,
    body: UploadPaymentProofBody,
  ) => {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new ApiError("Transaction not found", 404);
    }

    if (transaction.userId !== userId) {
      throw new ApiError(
        "You don't have permission to update this transaction",
        403,
      );
    }

    if (transaction.status !== "WAITING_PAYMENT") {
      throw new ApiError("Transaction is not in waiting payment status", 400);
    }

    // Check if expired
    if (new Date() > transaction.expiredAt) {
      // Auto expire and rollback
      await this.rollbackTransaction(transactionId);
      throw new ApiError("Payment deadline has expired", 400);
    }

    const updatedTransaction = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        paymentProof: body.paymentProof,
        status: "WAITING_CONFIRMATION",
        // We do NOT manually set updatedAt here.
        // Prisma @updatedAt will automatically set it to NOW.
        // The detailed rule says: "If organizer doesn't accept/reject within 3 days".
        // The job checks: updatedAt < NOW - 3 Days.
        // So resetting updatedAt to NOW is exactly what we want to start the 3-day timer.
      },
      include: {
        event: {
          include: {
            organizer: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    avatar: true,
                  },
                },
              },
            },
          },
        },
        ticketType: true,
        voucher: true,
        coupon: true,
      },
    });

    return updatedTransaction;
  };

  confirmTransaction = async (transactionId: number, organizerId: number) => {
    const organizer = await this.prisma.organizer.findUnique({
      where: { userId: organizerId },
    });

    if (!organizer) {
      throw new ApiError("Organizer not found", 404);
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        event: true,
      },
    });

    if (!transaction) {
      throw new ApiError("Transaction not found", 404);
    }

    if (transaction.event.organizerId !== organizer.id) {
      throw new ApiError(
        "You don't have permission to confirm this transaction",
        403,
      );
    }

    if (transaction.status !== "WAITING_CONFIRMATION") {
      throw new ApiError(
        "Transaction is not in waiting confirmation status",
        400,
      );
    }

    const updatedTransaction = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: "DONE",
      },
      include: {
        event: {
          include: {
            organizer: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    avatar: true,
                  },
                },
              },
            },
          },
        },
        ticketType: true,
        voucher: true,
        coupon: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    // Send email notification to customer
    await sendEmail({
      to: updatedTransaction.user.email,
      subject: "Transaction Confirmed - Event Ticket",
      html: `
        <h1>Transaction Confirmed</h1>
        <p>Dear ${updatedTransaction.user.name},</p>
        <p>Your transaction for event <strong>${updatedTransaction.event.title}</strong> has been confirmed.</p>
        <p>Ticket Type: ${updatedTransaction.ticketType.name}</p>
        <p>Quantity: ${updatedTransaction.ticketQty}</p>
        <p>Have a great time!</p>
      `,
    });

    return updatedTransaction;
  };

  rejectTransaction = async (transactionId: number, organizerId: number) => {
    const organizer = await this.prisma.organizer.findUnique({
      where: { userId: organizerId },
    });

    if (!organizer) {
      throw new ApiError("Organizer not found", 404);
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        event: true,
      },
    });

    if (!transaction) {
      throw new ApiError("Transaction not found", 404);
    }

    if (transaction.event.organizerId !== organizer.id) {
      throw new ApiError(
        "You don't have permission to reject this transaction",
        403,
      );
    }

    if (transaction.status !== "WAITING_CONFIRMATION") {
      throw new ApiError(
        "Transaction is not in waiting confirmation status",
        400,
      );
    }

    // Rollback in transaction
    await this.rollbackTransaction(transactionId);

    const updatedTransaction = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: "REJECTED",
      },
      include: {
        event: {
          include: {
            organizer: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    avatar: true,
                  },
                },
              },
            },
          },
        },
        ticketType: true,
        voucher: true,
        coupon: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    // Send email notification to customer
    await sendEmail({
      to: updatedTransaction.user.email,
      subject: "Transaction Rejected - Event Ticket",
      html: `
        <h1>Transaction Rejected</h1>
        <p>Dear ${updatedTransaction.user.name},</p>
        <p>Your transaction for event <strong>${updatedTransaction.event.title}</strong> has been rejected by the organizer.</p>
        <p>If you have used any points or vouchers, they have been restored to your account.</p>
      `,
    });

    return updatedTransaction;
  };

  cancelTransaction = async (transactionId: number, userId: number) => {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
    });

    if (!transaction) {
      throw new ApiError("Transaction not found", 404);
    }

    if (transaction.userId !== userId) {
      throw new ApiError(
        "You don't have permission to cancel this transaction",
        403,
      );
    }

    if (
      !["WAITING_PAYMENT", "WAITING_CONFIRMATION"].includes(transaction.status)
    ) {
      throw new ApiError("Transaction cannot be cancelled at this stage", 400);
    }

    // Rollback in transaction
    await this.rollbackTransaction(transactionId);

    const updatedTransaction = await this.prisma.transaction.update({
      where: { id: transactionId },
      data: {
        status: "CANCELLED",
      },
      include: {
        event: {
          include: {
            organizer: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    avatar: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        ticketType: true,
        voucher: true,
        coupon: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    // Send email notification to organizer
    // Note: The organizer user email is deeply nested in the include hierarchy
    const organizerEmail = updatedTransaction.event.organizer.user.email;

    // Only send email if cancelled by user (which is this endpoint logic)
    // If auto-cancelled by job, it might call this or similar logic.
    // For now assuming this endpoint is called by user manually cancelling before confirmation (if allowed) or system.
    // In this specific method 'cancelTransaction', it checks if transaction.userId === userId, so it's the customer cancelling.
    // So we notify the organizer.

    // But wait, the standard flow says "Organizer doesn't accept/reject within 3 days -> Auto Cancel".
    // This endpoint allows USER to cancel? Checking logic...
    // Yes: "transaction.userId !== userId -> throw 403". So this is CUSTOMER cancelling.

    await sendEmail({
      to: organizerEmail || "", // Should be available
      subject: "Transaction Cancelled by User",
      html: `
        <h1>Transaction Cancelled</h1>
        <p>A transaction for your event <strong>${updatedTransaction.event.title}</strong> has been cancelled by the user.</p>
        <p>Transaction ID: ${updatedTransaction.id}</p>
      `,
    });

    return updatedTransaction;
  };

  getMyTransactions = async (
    userId: number,
    page: number = 1,
    take: number = 10,
  ) => {
    // 1. Auto-expire: find WAITING_PAYMENT transactions that are past their deadline
    const expiredWaiting = await this.prisma.transaction.findMany({
      where: {
        userId,
        status: "WAITING_PAYMENT",
        expiredAt: { lt: new Date() },
      },
    });

    // Rollback and mark each as EXPIRED
    for (const txn of expiredWaiting) {
      await this.rollbackTransaction(txn.id);
      await this.prisma.transaction.update({
        where: { id: txn.id },
        data: { status: "EXPIRED" },
      });
    }

    // 2. Fetch paginated transactions
    const where = { userId };

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          event: {
            select: {
              title: true,
              image: true,
              startDate: true,
            },
          },
          ticketType: {
            select: {
              name: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * take,
        take,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    // 3. DTO transformation
    const data = transactions.map((txn) => ({
      id: txn.id,
      eventTitle: txn.event.title,
      eventImage: txn.event.image,
      eventStartDate: txn.event.startDate,
      ticketTypeName: txn.ticketType.name,
      ticketQty: txn.ticketQty,
      totalPrice: txn.totalPrice,
      finalPrice: txn.finalPrice,
      status: txn.status,
      createdAt: txn.createdAt,
      expiredAt: txn.expiredAt,
    }));

    return {
      data,
      meta: { page, take, total },
    };
  };

  getOrganizerTransactions = async (userId: number) => {
    // 1. Get organizer profile
    const organizer = await this.prisma.organizer.findUnique({
      where: { userId },
    });

    if (!organizer) {
      // If organizer profile doesn't exist, they have no transactions yet.
      // Return empty list instead of error.
      return [];
    }

    // 2. Get all transactions for events belonging to this organizer
    const transactions = await this.prisma.transaction.findMany({
      where: {
        event: {
          organizerId: organizer.id,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        event: true,
        ticketType: true,
        voucher: true,
        coupon: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return transactions;
  };

  getTransactionById = async (transactionId: number, userId: number) => {
    // Auto-expire check for this specific transaction
    const existing = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { status: true, expiredAt: true },
    });

    if (
      existing &&
      existing.status === "WAITING_PAYMENT" &&
      existing.expiredAt < new Date()
    ) {
      await this.rollbackTransaction(transactionId);
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: { status: "EXPIRED" },
      });
    }

    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        event: {
          select: {
            title: true,
            image: true,
            startDate: true,
            endDate: true,
            location: true,
            venue: true,
            organizerId: true,
          },
        },
        ticketType: {
          select: {
            name: true,
            price: true,
          },
        },
        voucher: {
          select: {
            code: true,
            discountAmount: true,
            discountType: true,
          },
        },
        coupon: {
          select: {
            code: true,
            discountAmount: true,
          },
        },
        payment: {
          select: {
            paymentMethod: true,
            status: true,
            paidAt: true,
          },
        },
        attendees: {
          select: {
            id: true,
            userId: true,
            checkedIn: true,
            checkedInAt: true,
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!transaction) {
      throw new ApiError("Transaction not found", 404);
    }

    // Check if user has permission (either customer or organizer)
    const organizer = await this.prisma.organizer.findUnique({
      where: { userId },
    });

    if (
      transaction.userId !== userId &&
      (!organizer || transaction.event.organizerId !== organizer.id)
    ) {
      throw new ApiError(
        "You don't have permission to view this transaction",
        403,
      );
    }

    // DTO transformation
    return {
      id: transaction.id,
      event: transaction.event,
      ticketType: transaction.ticketType,
      ticketQty: transaction.ticketQty,
      totalPrice: transaction.totalPrice,
      voucher: transaction.voucher,
      coupon: transaction.coupon,
      pointsUsed: transaction.pointsUsed,
      finalPrice: transaction.finalPrice,
      status: transaction.status,
      paymentProof: transaction.paymentProof,
      payment: transaction.payment,
      attendees: transaction.attendees,
      createdAt: transaction.createdAt,
      expiredAt: transaction.expiredAt,
    };
  };

  // Private helper method for rollback
  private rollbackTransaction = async (transactionId: number) => {
    await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.transaction.findUnique({
        where: { id: transactionId },
      });

      if (!transaction) {
        throw new ApiError("Transaction not found", 404);
      }

      // 1. Restore seats
      await tx.ticketType.update({
        where: { id: transaction.ticketTypeId },
        data: {
          availableSeat: { increment: transaction.ticketQty },
          sold: { decrement: transaction.ticketQty },
        },
      });

      // 2. Restore voucher usage
      if (transaction.voucherId) {
        await tx.voucher.update({
          where: { id: transaction.voucherId },
          data: {
            usedCount: { decrement: 1 },
          },
        });
      }

      // 3. Restore coupon
      if (transaction.couponId) {
        await tx.coupon.update({
          where: { id: transaction.couponId },
          data: {
            isUsed: false,
          },
        });
      }

      // 4. Restore points
      if (transaction.pointsUsed > 0) {
        await tx.user.update({
          where: { id: transaction.userId },
          data: {
            point: { increment: transaction.pointsUsed },
          },
        });

        // Record point restoration
        await tx.point.create({
          data: {
            userId: transaction.userId,
            amount: transaction.pointsUsed,
            description: `Restored from cancelled transaction #${transactionId}`,
            type: "EARNED",
          },
        });
      }
    });
  };

  // Auto expire transactions (to be called by cron job)
  expireTransactions = async () => {
    const expiredTransactions = await this.prisma.transaction.findMany({
      where: {
        status: "WAITING_PAYMENT",
        expiredAt: { lt: new Date() },
      },
    });

    for (const transaction of expiredTransactions) {
      await this.rollbackTransaction(transaction.id);
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: "EXPIRED",
        },
      });
    }

    return expiredTransactions.length;
  };

  // Auto cancel transactions (to be called by cron job)
  cancelTransactions = async () => {
    // Find transactions waiting for confirmation for more than 3 days
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const cancelledTransactions = await this.prisma.transaction.findMany({
      where: {
        status: "WAITING_CONFIRMATION",
        updatedAt: { lt: threeDaysAgo },
      },
    });

    for (const transaction of cancelledTransactions) {
      await this.rollbackTransaction(transaction.id);
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          status: "CANCELLED",
        },
      });
    }

    return cancelledTransactions.length;
  };
}
