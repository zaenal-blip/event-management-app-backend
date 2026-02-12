import express, { Router } from "express";
import { EventController } from "../event/event.controller.js";
import { AuthMiddleware } from "../../middleware/auth.middleware.js";

export class VoucherRouter {
    private router: Router;

    constructor(
        private eventController: EventController,
        private authMiddleware: AuthMiddleware
    ) {
        this.router = express.Router();
        this.initRoutes();
    }

    private initRoutes = () => {
        const authenticate = this.authMiddleware.verifyToken(
            process.env.JWT_SECRET || "secret"
        );
        const authorize = this.authMiddleware.verifyRole;

        this.router.get(
            "/organizer",
            authenticate,
            authorize(["ORGANIZER"]),
            this.eventController.getOrganizerVouchers
        );
    };

    getRouter = () => {
        return this.router;
    };
}
