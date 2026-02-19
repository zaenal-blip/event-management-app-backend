import { Request, Response } from "express";
import { ReviewService } from "./review.service.js";
import { AuthRequest } from "../../middleware/auth.middleware.js";

export class ReviewController {
  constructor(private reviewService: ReviewService) { }

  getEventReviews = async (req: Request, res: Response) => {
    const eventId = Number(req.params.eventId);
    const result = await this.reviewService.getEventReviews(eventId);
    res.status(200).send(result);
  };

  getUserCheckInStatus = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const eventId = Number(req.params.eventId);
    const result = await this.reviewService.getUserCheckInStatus(
      req.user.id,
      eventId
    );
    res.status(200).send(result);
  };

  createReview = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const eventId = Number(req.params.eventId);
    const result = await this.reviewService.createReview(
      req.user.id,
      eventId,
      req.body
    );
    res.status(201).send(result);
  };

  getOrganizerProfile = async (req: Request, res: Response) => {
    const organizerId = Number(req.params.organizerId);
    const result = await this.reviewService.getOrganizerProfile(organizerId);
    res.status(200).send(result);
  };
}
