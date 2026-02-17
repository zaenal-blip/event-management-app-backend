import {
  PrismaClient,
  NotificationType,
} from "../../generated/prisma/client.js";

export class NotificationService {
  constructor(private prisma: PrismaClient) {}

  getNotifications = async (
    userId: number,
    page: number = 1,
    limit: number = 20,
  ) => {
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    return {
      data: notifications,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  };

  getUnreadCount = async (userId: number) => {
    const count = await this.prisma.notification.count({
      where: { userId, isRead: false },
    });
    return { count };
  };

  markAsRead = async (notificationId: number, userId: number) => {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new Error("Notification not found");
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });
  };

  markAllAsRead = async (userId: number) => {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  };

  createNotification = async (
    userId: number,
    type: NotificationType,
    title: string,
    message: string,
    relatedUrl?: string,
  ) => {
    return this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        relatedUrl,
      },
    });
  };
}
