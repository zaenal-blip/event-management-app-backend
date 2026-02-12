import { PrismaClient } from "../../generated/prisma/client.js";
import { ApiError } from "../../utils/api-error.js";
import { CreateReviewBody } from "../../types/review.js";

export class ReviewService {
  constructor(private prisma: PrismaClient) {}

  getEventReviews = async (eventId: number) => {
    const reviews = await this.prisma.review.findMany({
      where: { eventId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return reviews;
  };

  createReview = async (
    userId: number,
    eventId: number,
    body: CreateReviewBody,
  ) => {
    const { rating, comment } = body;

    // Validate rating
    if (rating < 1 || rating > 5) {
      throw new ApiError("Rating must be between 1 and 5", 400);
    }

    // Check if event exists
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new ApiError("Event not found", 404);
    }

    // Check if event has ended
    if (new Date(event.endDate) > new Date()) {
      throw new ApiError("You can only review events that have ended", 400);
    }

    // Check if user has a completed transaction for this event
    const completedTransaction = await this.prisma.transaction.findFirst({
      where: {
        userId,
        eventId,
        status: "DONE",
      },
    });

    if (!completedTransaction) {
      throw new ApiError(
        "You can only review events you have attended (completed transaction required)",
        403,
      );
    }

    // Check if user already reviewed this event
    const existingReview = await this.prisma.review.findFirst({
      where: {
        userId,
        eventId,
      },
    });

    if (existingReview) {
      throw new ApiError("You have already reviewed this event", 400);
    }

    // Create review
    const review = await this.prisma.review.create({
      data: {
        userId,
        eventId,
        transactionId: completedTransaction.id,
        rating,
        comment,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    // Update organizer rating
    await this.updateOrganizerRating(event.organizerId);

    return review;
  };

  getOrganizerProfile = async (organizerId: number) => {
    const organizer = await this.prisma.organizer.findUnique({
      where: { id: organizerId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        events: {
          include: {
            reviews: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    avatar: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!organizer) {
      throw new ApiError("Organizer not found", 404);
    }

    // Calculate average rating from all reviews
    const allReviews = organizer.events.flatMap((e) => e.reviews);
    const avgRating =
      allReviews.length > 0
        ? allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length
        : 0;

    return {
      ...organizer,
      rating: avgRating,
      totalReviews: allReviews.length,
      reviews: allReviews,
    };
  };

  private updateOrganizerRating = async (organizerId: number) => {
    const organizer = await this.prisma.organizer.findUnique({
      where: { id: organizerId },
      include: {
        events: {
          include: {
            reviews: true,
          },
        },
      },
    });

    if (!organizer) return;

    const allReviews = organizer.events.flatMap((e) => e.reviews);
    const avgRating =
      allReviews.length > 0
        ? allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length
        : 0;

    await this.prisma.organizer.update({
      where: { id: organizerId },
      data: {
        rating: avgRating,
        totalReviews: allReviews.length,
      },
    });
  };
}
