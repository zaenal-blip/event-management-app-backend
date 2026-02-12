import express, { Router } from "express";
import { MediaController } from "./media.controller.js";
import { uploader } from "../../middleware/uploader.middleware.js";

export class MediaRouter {
  private router: Router;

  constructor(private mediaController: MediaController) {
    this.router = express.Router();
    this.initRoutes();
  }

  private initRoutes = () => {
    this.router.post(
      "/upload",
      uploader.single("file"),
      this.mediaController.uploadFile
    );
  };

  getRouter = () => {
    return this.router;
  };
}
