import { Response } from "express";
import { NotificationService } from "./notification.service.js";
import { AuthRequest } from "../../middleware/auth.middleware.js";

export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  getNotifications = async (req: AuthRequest, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      let isRead: boolean | undefined = undefined;

      if (req.query.isRead === "true") isRead = true;
      if (req.query.isRead === "false") isRead = false;

      const result = await this.notificationService.getNotifications(
        req.user!.id,
        page,
        limit,
        isRead,
      );
      res.status(200).json(result);
    } catch (error: any) {
      res
        .status(error.status || 500)
        .json({ message: error.message || "Failed to fetch notifications" });
    }
  };

  getUnreadCount = async (req: AuthRequest, res: Response) => {
    try {
      const result = await this.notificationService.getUnreadCount(
        req.user!.id,
      );
      res.status(200).json(result);
    } catch (error: any) {
      res
        .status(error.status || 500)
        .json({ message: error.message || "Failed to get unread count" });
    }
  };

  markAsRead = async (req: AuthRequest, res: Response) => {
    try {
      const notificationId = Number(req.params.id);
      const result = await this.notificationService.markAsRead(
        notificationId,
        req.user!.id,
      );
      res.status(200).json(result);
    } catch (error: any) {
      res
        .status(error.status || 500)
        .json({ message: error.message || "Failed to mark as read" });
    }
  };

  markAllAsRead = async (req: AuthRequest, res: Response) => {
    try {
      const result = await this.notificationService.markAllAsRead(req.user!.id);
      res.status(200).json(result);
    } catch (error: any) {
      res
        .status(error.status || 500)
        .json({ message: error.message || "Failed to mark all as read" });
    }
  };
}
