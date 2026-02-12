import express, { Router } from "express";
import { UserController } from "./user.controller.js";
import { AuthMiddleware } from "../../middleware/auth.middleware.js";

export class UserRouter {
  private router: Router;

  constructor(
    private userController: UserController,
    private authMiddleware: AuthMiddleware,
  ) {
    this.router = express.Router();
    this.initRoutes();
  }

  private initRoutes = () => {
    this.router.get("/", this.userController.getUsers);
    this.router.get("/:id", this.userController.getUser);
    this.router.post("/", this.userController.createUser);
    this.router.patch("/:id", this.userController.updateUser);
    this.router.patch(
      "/:id/password",
      this.authMiddleware.verifyToken(process.env.JWT_SECRET!),
      this.userController.updatePassword,
    );
    this.router.patch(
      "/:id/profile",
      this.authMiddleware.verifyToken(process.env.JWT_SECRET!),
      this.userController.updateProfile,
    );
    this.router.patch(
      "/:id/organizer-profile",
      this.authMiddleware.verifyToken(process.env.JWT_SECRET!),
      this.userController.updateOrganizerProfile,
    );
    this.router.get(
      "/:id/organizer-profile",
      this.authMiddleware.verifyToken(process.env.JWT_SECRET!),
      this.userController.getOrganizerProfile,
    );
    this.router.delete("/:id", this.userController.deleteUser);
  };

  getRouter = () => {
    return this.router;
  };
}
