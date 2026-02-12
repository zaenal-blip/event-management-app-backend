import multer from "multer";
import path from "path";
import { Request } from "express";
import { ApiError } from "../utils/api-error.js";

// storage configuration
const storage = multer.memoryStorage();

// filter for image files
const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new ApiError("Only image files are allowed", 400) as any, false);
  }
};

export const uploader = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});
