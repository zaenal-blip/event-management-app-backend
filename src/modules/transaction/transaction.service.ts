import { PrismaClient } from "../../generated/prisma/client.js";
import { ApiError } from "../../utils/api-error.js";
import {
  CreateTransactionBody,
  UploadPaymentProofBody,
} from "../../types/transaction.js";
import { MailService } from "../mail/mail.service.js";
import { NotificationService } from "../notification/notification.service.js";
import { sendEmail } from "../../lib/mail.js";
import { calculateUserPointBalance } from "../../utils/point.utils.js";
import crypto from "crypto";
import QRCode from "qrcode";

export class TransactionService {
  constructor(
    private prisma: PrismaClient,
    private mailService: MailService,
    private notificationService: NotificationService,
  ) { }

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
      // 1. Fetch ticket type with event — atomicity is guaranteed by $transaction
      console.log(`[DEBUG] Fetching ticketType ${ticketTypeId}`);
      const ticketTypeRelation = await tx.ticketType.findUnique({
        where: { id: ticketTypeId },
        include: { event: true },
      });

      if (!ticketTypeRelation) {
        throw new ApiError("Ticket type not found", 404);
      }

      if (ticketTypeRelation.eventId !== eventId) {
        throw new ApiError("Ticket type does not belong to this event", 400);
      }

      const ticketType = ticketTypeRelation;

      // Prevent organizer from buying their own event
      const event = ticketTypeRelation.event;
      if (event.organizerId) {
        const organizer = await tx.organizer.findUnique({
          where: { id: event.organizerId },
        });
        if (organizer && organizer.userId === userId) {
          throw new ApiError(
            "You cannot purchase tickets for your own event",
            403,
          );
        }
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
                    email: true,
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
          },
        },
      },
    });

    // Notify organizer about waiting approval
    const frontendUrl = process.env.BASE_FRONTEND_URL;
    const organizerUserId = updatedTransaction.event.organizer.user.id;
    const organizerEmail = updatedTransaction.event.organizer.user.email;

    // In-app notification for organizer
    await this.notificationService.createNotification(
      organizerUserId,
      "WAITING_APPROVAL",
      "New Payment Awaiting Approval",
      `${updatedTransaction.user.name} has submitted payment for ${updatedTransaction.event.title} (${updatedTransaction.ticketQty} ticket(s))`,
      `/dashboard/transactions`,
    );

    // Format currency for email
    const formattedAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(updatedTransaction.finalPrice);

    // Send waiting approval email to organizer
    try {
      await this.mailService.sendEmail(
        organizerEmail,
        `🔔 New Payment Awaiting Approval - ${updatedTransaction.event.title}`,
        "transaction-waiting-approval",
        {
          organizerName:
            updatedTransaction.event.organizer.user.name ||
            updatedTransaction.event.organizer.name ||
            "Organizer",
          customerName: updatedTransaction.user.name,
          eventTitle: updatedTransaction.event.title,
          ticketTypeName: updatedTransaction.ticketType.name,
          ticketQty: updatedTransaction.ticketQty,
          totalAmount: formattedAmount,
          orderId: updatedTransaction.id,
          dashboardLink: `${frontendUrl}/dashboard/transactions`,
        },
      );
    } catch (err) {
      console.error("Failed to send waiting-approval email to organizer:", err);
    }

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

    // Create Attendee records — 1 per seat (ticketQty)
    const attendees = [];
    for (let i = 0; i < updatedTransaction.ticketQty; i++) {
      const qrToken = crypto.randomBytes(32).toString("hex");
      const attendee = await this.prisma.attendee.create({
        data: {
          transactionId: updatedTransaction.id,
          userId: updatedTransaction.userId,
          eventId: updatedTransaction.eventId,
          ticketTypeId: updatedTransaction.ticketTypeId,
          qrToken,
        },
      });
      attendees.push(attendee);
    }

    // Generate QR code buffers as CID attachments (Gmail blocks data URLs)
    const frontendUrl = process.env.BASE_FRONTEND_URL;
    const ticketsForTemplate = [];
    const qrAttachments = [];
    for (let i = 0; i < attendees.length; i++) {
      const checkInUrl = `${frontendUrl}/check-in/${attendees[i].qrToken}`;
      const qrBuffer = await QRCode.toBuffer(checkInUrl, {
        width: 200,
        margin: 1,
        type: "png",
      });
      const cid = `qr-ticket-${i}@eventku`;
      ticketsForTemplate.push({
        ticketNumber: i + 1,
        qrCid: cid,
      });
      qrAttachments.push({
        filename: `qr-ticket-${i + 1}.png`,
        content: qrBuffer,
        cid,
        contentType: "image/png",
      });
    }

    // Format event date
    const eventDate = new Date(
      updatedTransaction.event.startDate,
    ).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // Send email using Handlebars template with CID attachments
    try {
      await this.mailService.sendEmail(
        updatedTransaction.user.email,
        `🎟 Your Ticket for ${updatedTransaction.event.title}`,
        "ticket-confirmation",
        {
          customerName: updatedTransaction.user.name,
          eventTitle: updatedTransaction.event.title,
          eventDate,
          eventVenue: updatedTransaction.event.venue || "",
          ticketTypeName: updatedTransaction.ticketType.name,
          ticketQty: updatedTransaction.ticketQty,
          orderId: updatedTransaction.id,
          tickets: ticketsForTemplate,
          viewTicketsLink: `${frontendUrl}/payment/${updatedTransaction.id}`,
        },
        qrAttachments,
      );
      console.log("✅ Ticket confirmation email sent successfully");
    } catch (err) {
      console.error("❌ Failed to send ticket confirmation email:", err);
    }

    // Small delay to avoid Gmail rate limiting
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Send payment receipt email
    try {
      const formatRupiah = (amount: number) =>
        new Intl.NumberFormat("id-ID", {
          style: "currency",
          currency: "IDR",
          minimumFractionDigits: 0,
        }).format(amount);

      const receiptDate = new Date().toLocaleDateString("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const receiptNumber = `RCP${Date.now().toString().slice(-10)}`;

      // Compute discount amounts
      const subtotal = updatedTransaction.totalPrice;
      const voucherDiscount = updatedTransaction.voucher
        ? updatedTransaction.voucher.discountType === "PERCENTAGE"
          ? Math.floor(
            subtotal * (updatedTransaction.voucher.discountAmount / 100),
          )
          : Math.min(updatedTransaction.voucher.discountAmount, subtotal)
        : 0;
      const couponDiscount = updatedTransaction.coupon
        ? Math.min(
          updatedTransaction.coupon.discountAmount,
          subtotal - voucherDiscount,
        )
        : 0;
      const pointsUsedAmount = updatedTransaction.pointsUsed;

      const organizerName =
        updatedTransaction.event.organizer.name ||
        updatedTransaction.event.organizer.user.name ||
        "Eventku Organizer";

      await this.mailService.sendEmail(
        updatedTransaction.user.email,
        `🧾 Struk Pembayaran - ${updatedTransaction.event.title}`,
        "payment-receipt",
        {
          receiptNumber,
          receiptDate,
          transactionId: updatedTransaction.id,
          organizerName,
          eventTitle: updatedTransaction.event.title,
          eventDate,
          eventVenue: updatedTransaction.event.venue || "",
          ticketTypeName: updatedTransaction.ticketType.name,
          ticketQty: updatedTransaction.ticketQty,
          subtotal: formatRupiah(subtotal),
          voucherDiscount:
            voucherDiscount > 0 ? formatRupiah(voucherDiscount) : null,
          voucherCode: updatedTransaction.voucher?.code || null,
          couponDiscount:
            couponDiscount > 0 ? formatRupiah(couponDiscount) : null,
          couponCode: updatedTransaction.coupon?.code || null,
          pointsUsed:
            updatedTransaction.pointsUsed > 0
              ? updatedTransaction.pointsUsed
              : null,
          pointsUsedAmount:
            pointsUsedAmount > 0 ? formatRupiah(pointsUsedAmount) : null,
          finalPrice: formatRupiah(updatedTransaction.finalPrice),
          customerName: updatedTransaction.user.name,
          customerEmail: updatedTransaction.user.email,
        },
      );
    } catch (err) {
      console.error("Failed to send payment receipt email:", err);
    }

    // In-app notification for customer
    await this.notificationService.createNotification(
      updatedTransaction.user.id,
      "TRANSACTION_ACCEPTED",
      "Transaction Approved! 🎉",
      `Your transaction for ${updatedTransaction.event.title} has been approved. Your tickets are ready!`,
      `/payment/${updatedTransaction.id}`,
    );

    return updatedTransaction;
  };

  rejectTransaction = async (
    transactionId: number,
    organizerId: number,
    reason?: string,
  ) => {
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
        rejectionReason: reason,
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

    // Format currency for email
    const formattedAmount = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(transaction.finalPrice);

    const frontendUrl = process.env.BASE_FRONTEND_URL;

    // Send rejection email using template
    await this.mailService.sendEmail(
      updatedTransaction.user.email,
      `❌ Transaction Rejected - ${updatedTransaction.event.title}`,
      "transaction-rejected",
      {
        customerName: updatedTransaction.user.name,
        eventTitle: updatedTransaction.event.title,
        ticketTypeName: updatedTransaction.ticketType.name,
        ticketQty: transaction.ticketQty,
        totalAmount: formattedAmount,
        orderId: updatedTransaction.id,
        rejectionReason: reason || "",
        browseEventsLink: `${frontendUrl}/events`,
      },
    );

    // In-app notification for customer
    await this.notificationService.createNotification(
      updatedTransaction.user.id,
      "TRANSACTION_REJECTED",
      "Transaction Rejected",
      `Your transaction for ${updatedTransaction.event.title} has been rejected.${reason ? ` Reason: ${reason}` : ""}`,
      `/transactions`,
    );

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
      rejectionReason: txn.rejectionReason,
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
            qrToken: true,
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
      rejectionReason: transaction.rejectionReason,
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

        // Delete the USED point record instead of creating a new EARNED one.
        // Creating a new EARNED record causes double-counting in FIFO balance
        // calculation because the original earned points still exist.
        await tx.point.deleteMany({
          where: {
            userId: transaction.userId,
            type: "USED",
            description: {
              contains: `transaction on event`,
            },
            amount: -transaction.pointsUsed,
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

  // ─── TICKET & CHECK-IN ────────────────────────────────────────────

  /**
   * Get tickets (attendees) for a transaction — customer only
   */
  getTicketsByTransaction = async (transactionId: number, userId: number) => {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: {
        id: true,
        status: true,
        userId: true,
        ticketQty: true,
        event: {
          select: {
            title: true,
            startDate: true,
            endDate: true,
            location: true,
            venue: true,
            image: true,
          },
        },
        ticketType: {
          select: { name: true, price: true },
        },
        attendees: {
          select: {
            id: true,
            qrToken: true,
            checkedIn: true,
            checkedInAt: true,
            user: {
              select: { name: true, email: true },
            },
          },
        },
      },
    });

    if (!transaction) {
      throw new ApiError("Transaction not found", 404);
    }

    if (transaction.userId !== userId) {
      throw new ApiError(
        "You don't have permission to view these tickets",
        403,
      );
    }

    if (transaction.status !== "DONE") {
      throw new ApiError(
        "Tickets are only available for confirmed transactions",
        400,
      );
    }

    return {
      transactionId: transaction.id,
      event: transaction.event,
      ticketType: transaction.ticketType,
      ticketQty: transaction.ticketQty,
      tickets: transaction.attendees.map((att) => ({
        id: att.id,
        qrToken: att.qrToken,
        attendeeName: att.user.name,
        attendeeEmail: att.user.email,
        checkedIn: att.checkedIn,
        checkedInAt: att.checkedInAt,
      })),
    };
  };

  /**
   * Check-in an attendee via QR token (public endpoint, token is auth)
   */
  checkIn = async (qrToken: string) => {
    const attendee = await this.prisma.attendee.findUnique({
      where: { qrToken },
      include: {
        transaction: { select: { status: true } },
        event: { select: { title: true, endDate: true } },
        ticketType: { select: { name: true } },
        user: { select: { name: true, email: true } },
      },
    });

    if (!attendee) {
      throw new ApiError("Invalid ticket — QR code not found", 404);
    }

    if (attendee.transaction.status !== "DONE") {
      throw new ApiError("Transaction is not confirmed", 400);
    }

    if (attendee.event.endDate && attendee.event.endDate < new Date()) {
      throw new ApiError("This event has already ended", 400);
    }

    if (attendee.checkedIn) {
      return {
        success: false,
        message: "Already checked in",
        attendee: {
          name: attendee.user.name,
          event: attendee.event.title,
          ticketType: attendee.ticketType.name,
          checkedInAt: attendee.checkedInAt,
        },
      };
    }

    await this.prisma.attendee.update({
      where: { qrToken },
      data: {
        checkedIn: true,
        checkedInAt: new Date(),
      },
    });

    return {
      success: true,
      message: "Check-in successful!",
      attendee: {
        name: attendee.user.name,
        event: attendee.event.title,
        ticketType: attendee.ticketType.name,
        checkedInAt: new Date(),
      },
    };
  };
}
