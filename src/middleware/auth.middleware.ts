import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/api-error.js";
import jwt from "jsonwebtoken";
import { Role } from "../generated/prisma/enums.js";

export interface AuthRequest extends Request {
  user?: {
    id: number;
    name: string;
    email: string;
    role: Role;
  };
}

export class AuthMiddleware {
  verifyToken = (secretKey: string) => {
    return (req: Request, res: Response, next: NextFunction) => {
      let token = req.headers.authorization?.split(" ")[1];

      if (!token) {
        token = req.cookies?.accessToken;
      }

      if (!token) {
        throw new ApiError("Token Not Found", 401);
      }
      jwt.verify(token, secretKey, (err, payload) => {
        if (err) {
          if (err instanceof jwt.JsonWebTokenError) {
            throw new ApiError("Token Expired", 401);
          } else {
            throw new ApiError("Token Invalid", 401);
          }
        }
        (req as AuthRequest).user = payload as any;
        res.locals.user = payload;
        next();
      });
    };
  };
  verifyRole = (roles: Role[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
      const userRole = res.locals.user.role;
      if (!userRole || !roles.includes(userRole)) {
        throw new ApiError("Unauthorized", 403);
      }
      next();
    };
  };
}
