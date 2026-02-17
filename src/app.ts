import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma.js";
import { ApiError } from "./utils/api-error.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { UserService } from "./modules/user/user.service.js";
import { EventService } from "./modules/event/event.service.js";
import { TransactionService } from "./modules/transaction/transaction.service.js";
import { ReviewService } from "./modules/review/review.service.js";
import { AuthController } from "./modules/auth/auth.controller.js";
import { UserController } from "./modules/user/user.controller.js";
import { EventController } from "./modules/event/event.controller.js";
import { ReferralService } from "./modules/user/referral.service.js";
import { TransactionController } from "./modules/transaction/transaction.controller.js";
import { ReviewController } from "./modules/review/review.controller.js";
import { AuthRouter } from "./modules/auth/auth.router.js";
import { UserRouter } from "./modules/user/user.router.js";
import { EventRouter } from "./modules/event/event.router.js";
import { TransactionRouter } from "./modules/transaction/transaction.router.js";
import { ReviewRouter } from "./modules/review/review.router.js";
import { MediaController } from "./modules/media/media.controller.js";
import { MediaRouter } from "./modules/media/media.router.js";
import { VoucherRouter } from "./modules/voucher/voucher.router.js";
import { AuthMiddleware } from "./middleware/auth.middleware.js";
import { ValidationMiddleware } from "./middleware/validation.middleware.js";
import { DashboardService } from "./modules/dashboard/dashboard.service.js";
import { DashboardController } from "./modules/dashboard/dashboard.controller.js";
import { DashboardRouter } from "./modules/dashboard/dashboard.router.js";
import { OrganizerService } from "./modules/organizer/organizer.service.js";
import { OrganizerController } from "./modules/organizer/organizer.controller.js";
import { OrganizerRouter } from "./modules/organizer/organizer.router.js";
import { NotificationService } from "./modules/notification/notification.service.js";
import { NotificationController } from "./modules/notification/notification.controller.js";
import { NotificationRouter } from "./modules/notification/notification.router.js";

import { CloudinaryService } from "./modules/cloudinary/cloudinary.service.js";
import { MailService } from "./modules/mail/mail.service.js";
import { Scheduler } from "./jobs/scheduler.js";
import { cookieOptions } from "./config/cookie.js";
import { corsOptions } from "./config/cors.js";
import cookieParser from "cookie-parser";

const PORT = 8000;

export class App {
  app: express.Express;

  constructor() {
    this.app = express();
    this.configure();
    this.registerModules();
    this.handleError();
  }

  private configure = () => {
    this.app.use(cors(corsOptions));
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(cookieParser());
  };

  private registerModules = () => {
    // shared dependency
    const prismaClient = prisma;

    // services
    const cloudinaryService = new CloudinaryService();
    const mailService = new MailService();
    const notificationService = new NotificationService(prismaClient);
    const authService = new AuthService(prismaClient, mailService);
    const userService = new UserService(
      prismaClient,
      cloudinaryService,
      mailService,
    );
    const referralService = new ReferralService(prismaClient);
    const eventService = new EventService(prismaClient);
    const transactionService = new TransactionService(
      prismaClient,
      mailService,
      notificationService,
    );
    const reviewService = new ReviewService(prismaClient);
    const dashboardService = new DashboardService(prismaClient);
    const organizerService = new OrganizerService(prismaClient);

    // controllers
    const authController = new AuthController(authService);
    const userController = new UserController(userService, referralService);
    const eventController = new EventController(eventService);
    const transactionController = new TransactionController(transactionService);
    const reviewController = new ReviewController(reviewService);
    const dashboardController = new DashboardController(
      dashboardService,
      prismaClient,
    );
    const organizerController = new OrganizerController(organizerService);
    const notificationController = new NotificationController(
      notificationService,
    );

    // middlewares
    const authMiddleware = new AuthMiddleware();
    const validationMiddleware = new ValidationMiddleware();

    // routes
    const authRouter = new AuthRouter(authController, validationMiddleware);
    const userRouter = new UserRouter(userController, authMiddleware);
    const eventRouter = new EventRouter(
      eventController,
      authMiddleware,
      validationMiddleware,
    );
    const transactionRouter = new TransactionRouter(
      transactionController,
      authMiddleware, // Inject authMiddleware
    );
    const reviewRouter = new ReviewRouter(reviewController, authMiddleware); // Inject authMiddleware

    // media
    const mediaController = new MediaController(cloudinaryService);
    const mediaRouter = new MediaRouter(mediaController);
    const voucherRouter = new VoucherRouter(eventController, authMiddleware);
    const dashboardRouter = new DashboardRouter(
      dashboardController,
      authMiddleware,
    );
    const organizerRouter = new OrganizerRouter(
      organizerController,
      authMiddleware,
    );
    const notificationRouter = new NotificationRouter(
      notificationController,
      authMiddleware,
    );

    // entry point
    this.app.use("/auth", authRouter.getRouter());
    this.app.use("/users", userRouter.getRouter());
    this.app.use("/events", eventRouter.getRouter());
    this.app.use("/vouchers", voucherRouter.getRouter());
    this.app.use("/", transactionRouter.getRouter()); // Transactions use root-level routes
    this.app.use("/", reviewRouter.getRouter()); // Reviews use root-level routes
    this.app.use("/media", mediaRouter.getRouter());
    this.app.use("/dashboard", dashboardRouter.getRouter());
    this.app.use("/organizer", organizerRouter.getRouter());
    this.app.use("/notifications", notificationRouter.getRouter());

    // serve uploaded files
    this.app.use("/uploads", express.static("uploads"));

    // Initialize scheduler for background jobs
    new Scheduler(prismaClient);
  };

  private handleError = () => {
    this.app.use(
      (
        err: ApiError,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
      ) => {
        const message = err.message || "Something went wrong!";
        const status = err.status || 500;
        console.error(`[ERROR] ${status} - ${message}`, err);
        res.status(status).send({ message });
      },
    );

    this.app.use((req: express.Request, res: express.Response) => {
      res.status(404).send({ message: "Route not found" });
    });
  };

  start() {
    this.app.listen(PORT, () => {
      console.log(`Server running on port : ${PORT}`);
    });
  }
}
