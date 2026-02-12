import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/api-error.js";

export function createUserValidator(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.body.name) {
    throw new ApiError("Name is Required", 400);
  }
  if (!req.body.email) {
    throw new ApiError("Email is Required", 400);
  }
  if (!req.body.password) {
    throw new ApiError("Password is Required", 400);
  }
  if (!req.body.city) {
    throw new ApiError("City is Required", 400);
  }
  if (!req.body.street) {
    throw new ApiError("Street is Required", 400);
  }
  next();
}
