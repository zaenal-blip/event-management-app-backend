import express, { Router } from "express";
import { EventController } from "./event.controller.js";
import { AuthMiddleware } from "../../middleware/auth.middleware.js";
import { ValidationMiddleware } from "../../middleware/validation.middleware.js";
import { CreateEventDto } from "./dto/create-event.dto.js";
import { UpdateEventDto } from "./dto/update-event.dto.js";

export class EventRouter {
  private router: Router;

  constructor(
    private eventController: EventController,
    private authMiddleware: AuthMiddleware,
    private validationMiddleware: ValidationMiddleware
  ) {
    this.router = express.Router();
    this.initRoutes();
  }

  private initRoutes = () => {
    // Middleware shorthand
    const authenticate = this.authMiddleware.verifyToken(
      process.env.JWT_SECRET || "secret"
    );
    const authorize = this.authMiddleware.verifyRole;

    // Protected routes (organizer only) — must be before /:id to avoid matching "me" as an id
    this.router.get(
      "/me",
      authenticate,
      authorize(["ORGANIZER"]),
      this.eventController.getOrganizerEvents
    );
    this.router.get(
      "/me/attendees",
      authenticate,
      authorize(["ORGANIZER"]),
      this.eventController.getOrganizerAttendees
    );

    // Public routes
    this.router.get("/", this.eventController.getEvents);
    this.router.get("/:slug", this.eventController.getEventBySlug);
    this.router.get("/id/:id", this.eventController.getEventById);
    this.router.post(
      "/",
      authenticate,
      authorize(["ORGANIZER"]),
      this.validationMiddleware.validateBody(CreateEventDto),
      this.eventController.createEvent
    );
    this.router.post(
      "/:eventId/vouchers",
      authenticate,
      authorize(["ORGANIZER"]),
      this.eventController.createVoucher
    );
    this.router.put(
      "/:id/publish",
      authenticate,
      authorize(["ORGANIZER"]),
      this.eventController.publishEvent
    );

    this.router.patch(
      "/:id",
      authenticate,
      authorize(["ORGANIZER"]),
      this.validationMiddleware.validateBody(UpdateEventDto),
      this.eventController.updateEvent
    );

    this.router.delete(
      "/:id",
      authenticate,
      authorize(["ORGANIZER"]),
      this.eventController.deleteEvent
    );
  };

  getRouter = () => {
    return this.router;
  };
}
