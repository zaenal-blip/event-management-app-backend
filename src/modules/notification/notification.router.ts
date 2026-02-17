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
    const authenticate = this.authMiddleware.verifyToken(
      process.env.JWT_SECRET || "secret",
    );

    this.router.get(
      "/",
      authenticate,
      this.notificationController.getNotifications,
    );
    this.router.get(
      "/unread-count",
      authenticate,
      this.notificationController.getUnreadCount,
    );
    this.router.put(
      "/mark-all-read",
      authenticate,
      this.notificationController.markAllAsRead,
    );
    this.router.put(
      "/:id/read",
      authenticate,
      this.notificationController.markAsRead,
    );
  };

  getRouter = () => this.router;
}
