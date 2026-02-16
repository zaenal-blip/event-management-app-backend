import express, { Router } from "express";
import { OrganizerController } from "./organizer.controller.js";
import { AuthMiddleware } from "../../middleware/auth.middleware.js";

export class OrganizerRouter {
  private router: Router;

  constructor(
    private organizerController: OrganizerController,
    private authMiddleware: AuthMiddleware,
  ) {
    this.router = express.Router();
    this.initRoutes();
  }

  private initRoutes = () => {
    const authenticate = this.authMiddleware.verifyToken(
      process.env.JWT_SECRET || "secret",
    );
    const authorize = this.authMiddleware.verifyRole;

    // All routes require authentication + ORGANIZER role
    this.router.use(authenticate, authorize(["ORGANIZER"]));

    // Events list (for filter dropdowns)
    this.router.get("/events", this.organizerController.getEvents);

    // Buyers (transaction view)
    this.router.get("/buyers", this.organizerController.getBuyers);
    this.router.get("/buyers/export", this.organizerController.exportBuyersCSV);

    // Attendees (seat-level view)
    this.router.get("/attendees", this.organizerController.getAttendees);
    this.router.get(
      "/attendees/export",
      this.organizerController.exportAttendeesCSV,
    );
  };

  getRouter = () => this.router;
}
