import { PrismaClient } from "../../generated/prisma/client.js";
import { ApiError } from "../../utils/api-error.js";
import { CreateReviewBody } from "../../types/review.js";

export class ReviewService {
  constructor(private prisma: PrismaClient) { }

  getEventReviews = async (eventId: number) => {
    const reviews = await this.prisma.review.findMany({
      where: { eventId },
      include: {
        user: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return reviews.map((r) => ({
      rating: r.rating,
      comment: r.comment,
      reviewerName: r.user.name,
      createdAt: r.createdAt,
    }));
  };

  createReview = async (
    userId: number,
    eventId: number,
    body: CreateReviewBody,
  ) => {
    const { rating, comment } = body;

    // 1️⃣ Find event
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new ApiError("Event not found", 404);
    }

    // 2️⃣ If event.endDate >= now() → 403 "Event not finished yet"
    if (new Date(event.endDate) >= new Date()) {
      throw new ApiError("Event not finished yet", 403);
    }

    // 3️⃣ Find transaction where:
    // transaction.userId = req.user.id
    // transaction.status = "DONE" (system uses DONE for completed)
    // transaction.ticketType.eventId = eventId
    const completedTransaction = await this.prisma.transaction.findFirst({
      where: {
        userId,
        status: "DONE",
        ticketType: {
          eventId: eventId
        }
      },
    });

    if (!completedTransaction) {
      throw new ApiError("You did not attend this event", 403);
    }

    // 4️⃣ If event.organizerId === req.user.id → 403 "Organizer cannot review own event"
    // Note: event.organizerId refers to the Organizer profile ID.
    // We need to check if the user is the owner of that organizer profile.
    const organizer = await this.prisma.organizer.findUnique({
      where: { id: event.organizerId }
    });

    if (organizer?.userId === userId) {
      throw new ApiError("Organizer cannot review own event", 403);
    }

    // 5️⃣ Check duplicate review → 400
    const existingReview = await this.prisma.review.findUnique({
      where: {
        userId_eventId: {
          userId,
          eventId,
        },
      },
    });

    if (existingReview) {
      throw new ApiError("You have already reviewed this event", 400);
    }

    // 6️⃣ Validate rating 1–5 → 400
    if (rating < 1 || rating > 5) {
      throw new ApiError("Rating must be between 1 and 5", 400);
    }

    // Create review
    const review = await this.prisma.review.create({
      data: {
        userId,
        eventId,
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

    // Aggregation Rule: Calculate from all reviews where review.event.organizerId = organizerId
    const aggregate = await this.prisma.review.aggregate({
      where: {
        event: {
          organizerId: organizerId,
        },
      },
      _avg: {
        rating: true,
      },
      _count: {
        id: true,
      },
    });

    // Get all reviews for the organizer
    const reviews = await this.prisma.review.findMany({
      where: {
        event: {
          organizerId: organizerId,
        },
      },
      include: {
        user: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      ...organizer,
      rating: aggregate._avg.rating || 0,
      totalReviews: aggregate._count.id,
      reviews: reviews.map((r) => ({
        rating: r.rating,
        comment: r.comment,
        reviewerName: r.user.name,
        createdAt: r.createdAt,
      })),
    };
  };
}
