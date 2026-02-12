import { ApiError } from "../utils/api-error.js";
import express from "express";

export const errorMiddleware = (
  err: ApiError,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const message = err.message || "Something went wrong!";
  const status = err.status || 500;
  res.status(status).send({ message });
};

export const notFoundMiddleware = (
  req: express.Request,
  res: express.Response,
) => {
  res.status(404).send({ message: "Route not found" });
};
