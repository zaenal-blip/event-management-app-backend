import express, { Router } from "express";
import { DashboardController } from "./dashboard.controller.js";
import { AuthMiddleware } from "../../middleware/auth.middleware.js";

export class DashboardRouter {
  private router: Router;

  constructor(
    private dashboardController: DashboardController,
    private authMiddleware: AuthMiddleware,
  ) {
    this.router = express.Router();
    this.initRoutes();
  }

  private initRoutes = () => {
    const authenticate = this.authMiddleware.verifyToken(
      process.env.JWT_SECRET || "secret",
    );

    this.router.get(
      "/summary",
      authenticate,
      this.dashboardController.getSummary,
    );
    this.router.get(
      "/analytics",
      authenticate,
      this.dashboardController.getAnalytics,
    );
  };

  getRouter = () => this.router;
}
