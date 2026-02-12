import { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { cookieOptions } from "../../config/cookie.js";

export class AuthController {
  constructor(private authService: AuthService) { }

  register = async (req: Request, res: Response) => {
    const body = req.body;
    const result = await this.authService.register(body);
    res.status(200).send(result);
  };

  login = async (req: Request, res: Response) => {
    const body = req.body;
    const result = await this.authService.login(body);

    res.cookie("accessToken", result.accessToken, cookieOptions);
    res.cookie("refreshToken", result.refreshToken, cookieOptions);
    const { refreshToken, ...response } = result;
    res.status(200).send(response);
  };

  logout = async (req: Request, res: Response) => {
    const { refreshToken } = req.cookies;
    const result = await this.authService.logout(refreshToken);
    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);
    res.status(200).send(result);
  };
  refresh = async (req: Request, res: Response) => {
    const { refreshToken } = req.cookies;
    const result = await this.authService.refresh(refreshToken);
    res.cookie("accessToken", result.accessToken, cookieOptions);
    res.status(200).send({ message: "Refresh success" });
  };

  forgotPassword = async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      const result = await this.authService.forgotPassword(email);
      res.status(200).send(result);
    } catch (error) {
      res.status(500).send({ message: "Internal server error" });
    }
  };

  resetPassword = async (req: Request, res: Response) => {
    const { token, newPassword } = req.body;
    const result = await this.authService.resetPassword(token, newPassword);
    res.status(200).send(result);
  };
}
