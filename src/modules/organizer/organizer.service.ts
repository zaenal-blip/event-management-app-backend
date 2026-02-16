import { PrismaClient, Prisma } from "../../generated/prisma/client.js";
import {
  mapTransactionToDTO,
  mapAttendeeToDTO,
  type BuyerDTO,
  type AttendeeDTO,
  type PaginatedResponse,
} from "./organizer.dto.js";

interface BuyerQueryParams {
  page: number;
  limit: number;
  eventId?: number;
  search?: string;
}

interface AttendeeQueryParams {
  page: number;
  limit: number;
  eventId?: number;
  status?: "checked_in" | "registered";
  search?: string;
}

export class OrganizerService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get organizer ID from user ID via relational lookup.
   */
  private getOrganizerId = async (userId: number): Promise<number | null> => {
    const organizer = await this.prisma.organizer.findUnique({
      where: { userId },
      select: { id: true },
    });
    return organizer?.id ?? null;
  };

  /**
   * Get organizer's events (for filter dropdowns).
   */
  getOrganizerEvents = async (userId: number) => {
    const organizerId = await this.getOrganizerId(userId);
    if (!organizerId) return [];

    return this.prisma.event.findMany({
      where: { organizerId },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    });
  };

  // ─── BUYERS (TRANSACTION VIEW) ──────────────────────────────────────────

  /**
   * Paginated buyers list. 1 row = 1 transaction (status=DONE only).
   * Relational filter: event.organizer.userId === userId
   */
  getBuyers = async (
    userId: number,
    params: BuyerQueryParams,
  ): Promise<PaginatedResponse<BuyerDTO>> => {
    const { page, limit, eventId, search } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.TransactionWhereInput = {
      status: "DONE",
      event: {
        organizer: { userId },
        ...(eventId ? { id: eventId } : {}),
      },
      ...(search
        ? {
            user: {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        include: {
          user: { select: { name: true, email: true } },
          event: { select: { title: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      data: transactions.map(mapTransactionToDTO),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  };

  // ─── ATTENDEES (SEAT-LEVEL VIEW) ───────────────────────────────────────

  /**
   * Paginated attendees list. 1 row = 1 ticket holder (seat).
   * Relational filter: event.organizer.userId === userId
   */
  getAttendees = async (
    userId: number,
    params: AttendeeQueryParams,
  ): Promise<PaginatedResponse<AttendeeDTO>> => {
    const { page, limit, eventId, status, search } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.AttendeeWhereInput = {
      event: {
        organizer: { userId },
        ...(eventId ? { id: eventId } : {}),
      },
      ...(status === "checked_in"
        ? { checkedIn: true }
        : status === "registered"
          ? { checkedIn: false }
          : {}),
      ...(search
        ? {
            user: {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };

    const [attendees, total] = await Promise.all([
      this.prisma.attendee.findMany({
        where,
        include: {
          user: { select: { name: true, email: true } },
          event: { select: { title: true } },
          ticketType: { select: { name: true } },
          transaction: {
            select: {
              finalPrice: true,
              user: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.attendee.count({ where }),
    ]);

    return {
      data: attendees.map(mapAttendeeToDTO),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  };

  // ─── CSV EXPORT ─────────────────────────────────────────────────────────

  /**
   * Export all buyers as CSV (no pagination).
   * Relational filter: event.organizer.userId === userId
   */
  exportBuyersCSV = async (userId: number): Promise<string> => {
    const transactions = await this.prisma.transaction.findMany({
      where: {
        status: "DONE",
        event: { organizer: { userId } },
      },
      include: {
        user: { select: { name: true, email: true } },
        event: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const header =
      "Buyer Name,Buyer Email,Event,Ticket Qty,Total Paid,Status,Date";
    const rows = transactions.map((txn) => {
      const dto = mapTransactionToDTO(txn);
      return [
        this.escapeCSV(dto.buyerName),
        this.escapeCSV(dto.buyerEmail),
        this.escapeCSV(dto.eventTitle),
        dto.ticketQty,
        dto.totalPaid,
        dto.status,
        dto.createdAt,
      ].join(",");
    });

    return [header, ...rows].join("\n");
  };

  /**
   * Export all attendees as CSV (no pagination).
   * Relational filter: event.organizer.userId === userId
   */
  exportAttendeesCSV = async (userId: number): Promise<string> => {
    const attendees = await this.prisma.attendee.findMany({
      where: {
        event: { organizer: { userId } },
      },
      include: {
        user: { select: { name: true, email: true } },
        event: { select: { title: true } },
        ticketType: { select: { name: true } },
        transaction: {
          select: {
            finalPrice: true,
            user: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const header =
      "Attendee Name,Email,Event,Ticket Type,Checked In,Checked In At,Buyer,Total Paid";
    const rows = attendees.map((att) => {
      const dto = mapAttendeeToDTO(att);
      return [
        this.escapeCSV(dto.attendeeName),
        this.escapeCSV(dto.email),
        this.escapeCSV(dto.event),
        this.escapeCSV(dto.ticketType),
        dto.checkedIn ? "Yes" : "No",
        dto.checkedInAt ?? "",
        this.escapeCSV(dto.buyerName),
        dto.totalPaid,
      ].join(",");
    });

    return [header, ...rows].join("\n");
  };

  /**
   * Escape a CSV field value (handles commas and quotes).
   */
  private escapeCSV = (value: string): string => {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };
}
