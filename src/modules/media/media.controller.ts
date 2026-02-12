import { Request, Response } from "express";
import { ApiError } from "../../utils/api-error.js";
import { CloudinaryService } from "../cloudinary/cloudinary.service.js";

export class MediaController {
  constructor(private cloudinaryService: CloudinaryService) {}

  uploadFile = async (req: Request, res: Response) => {
    if (!req.file) {
      throw new ApiError("No file uploaded", 400);
    }

    const result = await this.cloudinaryService.upload(req.file);

    res.status(200).send({
      message: "File uploaded successfully",
      url: result.secure_url,
      filename: result.public_id,
    });
  };
}
