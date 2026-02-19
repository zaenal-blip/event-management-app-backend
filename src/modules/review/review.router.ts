import express, { Router } from "express";
import { ReviewController } from "./review.controller.js";
import { AuthMiddleware } from "../../middleware/auth.middleware.js";

export class ReviewRouter {
  private router: Router;

  constructor(
    private reviewController: ReviewController,
    private authMiddleware: AuthMiddleware
  ) {
    this.router = express.Router();
    this.initRoutes();
  }

  private initRoutes = () => {
    // Middleware shorthand
    const authenticate = this.authMiddleware.verifyToken(
      process.env.JWT_SECRET || "secret"
    );

    // Public routes
    this.router.get(
      "/events/:eventId/reviews",
      this.reviewController.getEventReviews
    );
    this.router.get(
      "/organizers/:organizerId",
      this.reviewController.getOrganizerProfile
    );

    // Protected routes
    this.router.get(
      "/events/:eventId/check-in-status",
      authenticate,
      this.reviewController.getUserCheckInStatus
    );
    this.router.post(
      "/events/:eventId/reviews",
      authenticate,
      this.reviewController.createReview
    );
  };

  getRouter = () => {
    return this.router;
  };
}
