import { Router } from "express";
import { NotificationController } from "./notification.controller.js";
import { AuthMiddleware } from "../../middleware/auth.middleware.js";

export class NotificationRouter {
  private router: Router;

  constructor(
    private notificationController: NotificationController,
    private authMiddleware: AuthMiddleware,
  ) {
    this.router = Router();
    this.initRoutes();
  }

  private initRoutes = () => {
    this.router.get(
      "/",
      this.authMiddleware.verifyToken,
      this.notificationController.getNotifications,
    );
    this.router.get(
      "/unread-count",
      this.authMiddleware.verifyToken,
      this.notificationController.getUnreadCount,
    );
    this.router.put(
      "/mark-all-read",
      this.authMiddleware.verifyToken,
      this.notificationController.markAllAsRead,
    );
    this.router.put(
      "/:id/read",
      this.authMiddleware.verifyToken,
      this.notificationController.markAsRead,
    );
  };

  getRouter = () => this.router;
}
