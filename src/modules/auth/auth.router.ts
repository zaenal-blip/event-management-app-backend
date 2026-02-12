import { ValidationMiddleware } from "../../middleware/validation.middleware.js";
import { AuthController } from "./auth.controller.js";
import express, { Router } from "express";
import { RegisterDto } from "./dto/register.dto.js";
import { LoginDto } from "./dto/login.dto.js";
import { ForgotPasswordDto } from "./dto/forgot-password.dto.js";
import { ResetPasswordDto } from "./dto/reset-password.dto.js";

export class AuthRouter {
  private router: Router;
  constructor(
    private authController: AuthController,
    private validationMiddleware: ValidationMiddleware,
  ) {
    this.router = express.Router();
    this.initRoutes();
  }
  private initRoutes = () => {
    this.router.post(
      "/register",
      this.validationMiddleware.validateBody(RegisterDto),
      this.authController.register,
    );
    this.router.post(
      "/login",
      this.validationMiddleware.validateBody(LoginDto),
      this.authController.login,
    );
    this.router.post(
      "/forgot-password",
      this.validationMiddleware.validateBody(ForgotPasswordDto),
      this.authController.forgotPassword,
    );
    this.router.post(
      "/reset-password",
      this.validationMiddleware.validateBody(ResetPasswordDto),
      this.authController.resetPassword,
    );
    this.router.post("/refresh", this.authController.refresh);
    this.router.post("/logout", this.authController.logout);
  };
  getRouter = () => {
    return this.router;
  };
}
