import { PrismaClient, Prisma } from "../../generated/prisma/client.js";
import { ApiError } from "../../utils/api-error.js";
import {
  CreateEventBody,
  GetEventsQuery,
  CreateVoucherBody,
} from "../../types/event.js";
import { CreateEventDto, CreateTicketTypeDto } from "./dto/create-event.dto.js";
import { UpdateEventDto } from "./dto/update-event.dto.js";

export class EventService {
  constructor(private prisma: PrismaClient) { }

  private getOrCreateOrganizer = async (userId: number) => {
    let organizer = await this.prisma.organizer.findUnique({
      where: { userId },
    });

    if (!organizer) {
      // Fallback: Check if user has ORGANIZER role and create profile if missing
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new ApiError("User not found", 404);
      }

      if (user.role === "ORGANIZER") {
        organizer = await this.prisma.organizer.create({
          data: {
            userId: user.id,
            name: user.name,
            avatar: user.avatar,
          },
        });
      } else {
        throw new ApiError("Organizer not found", 404);
      }
    }

    return organizer;
  };

  getEvents = async (query: GetEventsQuery) => {
    const {
      page,
      take,
      sortBy,
      sortOrder,
      search,
      category,
      location,
      priceRange,
      startDate,
      endDate,
    } = query;

    const whereClause: Prisma.EventWhereInput = {
      status: "PUBLISHED",
    };

    // Search filter
    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
        { venue: { contains: search, mode: "insensitive" } },
      ];
    }

    // Category filter
    if (category) {
      whereClause.category = category;
    }

    // Location filter
    if (location) {
      whereClause.location = location;
    }

    // Price range filter (free/paid)
    if (priceRange === "free") {
      whereClause.ticketTypes = {
        some: {
          price: 0,
        },
      };
    } else if (priceRange === "paid") {
      whereClause.ticketTypes = {
        some: {
          price: { gt: 0 },
        },
      };
    }

    // Date filters
    if (startDate) {
      whereClause.startDate = { gte: new Date(startDate) };
    }
    if (endDate) {
      whereClause.endDate = { lte: new Date(endDate) };
    }

    const events = await this.prisma.event.findMany({
      where: whereClause,
      include: {
        organizer: {
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
        ticketTypes: true,
        vouchers: {
          where: {
            startDate: { lte: new Date() },
            endDate: { gte: new Date() },
          },
        },
        _count: {
          select: {
            reviews: true,
          },
        },
      },
      take: take,
      skip: (page - 1) * take,
      orderBy: { [sortBy]: sortOrder },
    });

    // Calculate organizer rating from reviews and compute seat data
    const eventsWithRating = await Promise.all(
      events.map(async (event) => {
        const reviews = await this.prisma.review.findMany({
          where: { eventId: event.id },
          select: { rating: true },
        });

        const avgRating =
          reviews.length > 0
            ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
            : 0;

        // Compute seat/price info from ticketTypes
        const totalSeats = event.ticketTypes.reduce((sum, tt) => sum + tt.totalSeat, 0);
        const availableSeats = event.ticketTypes.reduce((sum, tt) => sum + tt.availableSeat, 0);
        const price = event.ticketTypes.length > 0
          ? Math.min(...event.ticketTypes.map((tt) => tt.price))
          : 0;

        return {
          ...event,
          price,
          totalSeats,
          availableSeats: Math.max(availableSeats, 0),
          organizer: {
            ...event.organizer,
            rating: avgRating,
            totalReviews: reviews.length,
          },
        };
      }),
    );

    const total = await this.prisma.event.count({ where: whereClause });

    return {
      data: eventsWithRating,
      meta: { page, take, total },
    };
  };

  getOrganizerEvents = async (organizerId: number) => {
    const organizer = await this.getOrCreateOrganizer(organizerId);

    const events = await this.prisma.event.findMany({
      where: { organizerId: organizer.id },
      include: {
        ticketTypes: true,
        _count: {
          select: { attendees: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return events;
  };

  getEventById = async (id: number) => {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        organizer: {
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
        ticketTypes: true,
        vouchers: {
          where: {
            startDate: { lte: new Date() },
            endDate: { gte: new Date() },
          },
        },
      },
    });

    if (!event) {
      throw new ApiError("Event not found", 404);
    }

    // Calculate organizer rating
    const reviews = await this.prisma.review.findMany({
      where: { eventId: event.id },
      select: { rating: true },
    });

    const avgRating =
      reviews.length > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0;

    return {
      ...event,
      price: event.ticketTypes.length > 0
        ? Math.min(...event.ticketTypes.map((tt) => tt.price))
        : 0,
      totalSeats: event.ticketTypes.reduce((sum, tt) => sum + tt.totalSeat, 0),
      availableSeats: Math.max(event.ticketTypes.reduce((sum, tt) => sum + tt.availableSeat, 0), 0),
      organizer: {
        ...event.organizer,
        rating: avgRating,
        totalReviews: reviews.length,
      },
    };
  };

  createEvent = async (organizerId: number, body: CreateEventDto) => {
    // Validate organizer exists (or create if missing for existing users)
    const organizer = await this.getOrCreateOrganizer(organizerId);

    // Validate dates
    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);

    if (endDate <= startDate) {
      throw new ApiError("End date must be after start date", 400);
    }

    if (startDate <= new Date()) {
      throw new ApiError("Start date must be in the future", 400);
    }

    // Execute single transaction
    return await this.prisma.$transaction(async (tx) => {
      const event = await tx.event.create({
        data: {
          title: body.title,
          description: body.description,
          category: body.category,
          location: body.location,
          venue: body.venue,
          startDate,
          endDate,
          image: body.image ?? null,
          status: "PUBLISHED",
          organizerId: organizer.id,
          ticketTypes: {
            create: body.ticketTypes.map((tt: CreateTicketTypeDto) => ({
              name: tt.name,
              description: tt.description,
              price: tt.price,
              totalSeat: tt.totalSeat,
              availableSeat: tt.totalSeat,
            })),
          },
        },
        include: {
          ticketTypes: true,
        },
      });

      // Increment Organizer.totalEvents
      await tx.organizer.update({
        where: { id: organizer.id },
        data: {
          totalEvents: { increment: 1 },
        },
      });

      return event;
    });
  };

  createVoucher = async (
    eventId: number,
    organizerId: number,
    body: CreateVoucherBody,
  ) => {
    // Verify event belongs to organizer
    const organizer = await this.getOrCreateOrganizer(organizerId);

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new ApiError("Event not found", 404);
    }

    if (event.organizerId !== organizer.id) {
      throw new ApiError(
        "You don't have permission to create voucher for this event",
        403,
      );
    }

    // Validate event has not ended
    if (new Date().getTime() > new Date(event.endDate).getTime()) {
      throw new ApiError(
        "Cannot create voucher for an ended event",
        400,
      );
    }

    const startDate = new Date(body.startDate);
    const endDate = new Date(body.endDate);

    if (endDate <= startDate) {
      throw new ApiError("End date must be after start date", 400);
    }

    // Business validations
    if (body.discountAmount <= 0) {
      throw new ApiError("Discount amount must be greater than 0", 400);
    }

    if (body.usageLimit <= 0) {
      throw new ApiError("Usage limit (quota) must be greater than 0", 400);
    }

    // Check if voucher code already exists for this event
    const existingVoucher = await this.prisma.voucher.findUnique({
      where: {
        eventId_code: {
          eventId,
          code: body.code,
        },
      },
    });

    if (existingVoucher) {
      throw new ApiError("Voucher code already exists for this event", 400);
    }

    const voucher = await this.prisma.voucher.create({
      data: {
        eventId,
        code: body.code,
        discountAmount: body.discountAmount,
        discountType: body.discountType,
        startDate,
        endDate,
        usageLimit: body.usageLimit,
      },
    });

    return voucher;
  };

  publishEvent = async (eventId: number, organizerId: number) => {
    // Find organizer
    const organizer = await this.getOrCreateOrganizer(organizerId);

    // Find event and verify ownership
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new ApiError("Event not found", 404);
    }

    if (event.organizerId !== organizer.id) {
      throw new ApiError("Unauthorized to publish this event", 403);
    }

    if (event.status !== "DRAFT") {
      throw new ApiError("Only draft events can be published", 400);
    }

    // Update status to PUBLISHED
    const updatedEvent = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: "PUBLISHED" },
      include: {
        ticketTypes: true,
        organizer: {
          include: {
            user: true,
          },
        },
        vouchers: {
          where: {
            startDate: { lte: new Date() },
            endDate: { gte: new Date() },
          },
        },
      },
    });

    return updatedEvent;
  };

  getVouchersByOrganizer = async (userId: number) => {
    const organizer = await this.getOrCreateOrganizer(userId);

    const vouchers = await this.prisma.voucher.findMany({
      where: {
        event: {
          organizerId: organizer.id,
        },
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            image: true,
          },
        },
      },
      orderBy: { id: "desc" },
    });

    return vouchers;
  };

  getOrganizerAttendees = async (userId: number) => {
    const organizer = await this.getOrCreateOrganizer(userId);

    const attendees = await this.prisma.attendee.findMany({
      where: {
        event: {
          organizerId: organizer.id,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
        event: {
          select: {
            id: true,
            title: true,
          },
        },
        ticketType: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return attendees;
  };

  updateEvent = async (eventId: number, userId: number, body: UpdateEventDto) => {
    // 1️⃣ Find event
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { ticketTypes: true }
    });

    if (!event) {
      throw new ApiError("Event not found", 404);
    }

    // 2️⃣ Validate ownership
    const organizer = await this.getOrCreateOrganizer(userId);
    if (event.organizerId !== organizer.id) {
      throw new ApiError("Unauthorized to update this event", 403);
    }

    // 3️⃣ Validate seats
    // User requirement: Count sold tickets where transaction status = "COMPLETED" (DONE in our system)
    const transactionAggregate = await this.prisma.transaction.aggregate({
      where: {
        eventId: eventId,
        status: "DONE",
      },
      _sum: {
        ticketQty: true,
      },
    });

    const soldTicketsCount = transactionAggregate._sum.ticketQty || 0;

    if (body.availableSeats !== undefined && body.availableSeats < soldTicketsCount) {
      throw new ApiError(`Cannot reduce capacity below sold tickets count (${soldTicketsCount})`, 400);
    }

    // 4️⃣ Validate date
    const startDate = body.startDate ? new Date(body.startDate) : new Date(event.startDate);
    const endDate = body.endDate ? new Date(body.endDate) : new Date(event.endDate);

    if (endDate <= startDate) {
      throw new ApiError("End date must be after start date", 400);
    }

    // 5️⃣ Update fields
    // We update the Event and also sync the price/availableSeats to the first ticketType if present
    // to maintain existing architecture without breaking it.
    return await this.prisma.$transaction(async (tx) => {
      const updatedEvent = await tx.event.update({
        where: { id: eventId },
        data: {
          title: body.title,
          description: body.description,
          category: body.category,
          location: body.location,
          venue: body.venue,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          endDate: body.endDate ? new Date(body.endDate) : undefined,
          image: body.image,
        },
        include: { ticketTypes: true }
      });

      // Update the first ticket type if price or availableSeats provided
      if (updatedEvent.ticketTypes.length > 0 && (body.price !== undefined || body.availableSeats !== undefined)) {
        const firstTicket = updatedEvent.ticketTypes[0];

        // Calculate new availableSeat (remaining) if total capacity changed
        let newAvailableSeat = firstTicket.availableSeat;
        if (body.availableSeats !== undefined) {
          const soldForThisType = firstTicket.totalSeat - firstTicket.availableSeat;
          newAvailableSeat = body.availableSeats - soldForThisType;
        }

        await tx.ticketType.update({
          where: { id: firstTicket.id },
          data: {
            price: body.price !== undefined ? body.price : undefined,
            totalSeat: body.availableSeats !== undefined ? body.availableSeats : undefined,
            availableSeat: newAvailableSeat
          }
        });
      }

      return updatedEvent;
    });
  };

  deleteEvent = async (eventId: number, userId: number) => {
    // 1️⃣ Find event
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new ApiError("Event not found", 404);
    }

    // 2️⃣ Validate ownership
    const organizer = await this.getOrCreateOrganizer(userId);
    if (event.organizerId !== organizer.id) {
      throw new ApiError("Unauthorized to delete this event", 403);
    }

    // 3️⃣ Check if any transaction exists with status "DONE"
    const existingTransaction = await this.prisma.transaction.findFirst({
      where: {
        eventId: eventId,
        status: "DONE",
      },
    });

    if (existingTransaction) {
      throw new ApiError("Cannot delete event with existing transactions", 400);
    }

    // 4️⃣ Perform delete
    // Note: schema.prisma has onDelete: Cascade for many relations, 
    // but we've already blocked deletion if transactions exist.
    return await this.prisma.event.delete({
      where: { id: eventId },
    });
  };
}
