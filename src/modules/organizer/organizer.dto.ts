/**
 * DTO mapping layer for Organizer Dashboard.
 * Never return raw Prisma objects — always map through these functions.
 */

export interface BuyerDTO {
  id: number;
  buyerName: string;
  buyerEmail: string;
  eventTitle: string;
  ticketQty: number;
  totalPaid: number;
  status: string;
  createdAt: string;
}

export interface AttendeeDTO {
  id: number;
  attendeeName: string;
  email: string;
  event: string;
  ticketType: string;
  checkedIn: boolean;
  checkedInAt: string | null;
  buyerName: string;
  totalPaid: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Maps a Transaction (with relations) to a safe BuyerDTO.
 */
export const mapTransactionToDTO = (txn: any): BuyerDTO => ({
  id: txn.id,
  buyerName: txn.user?.name ?? "Unknown",
  buyerEmail: txn.user?.email ?? "Unknown",
  eventTitle: txn.event?.title ?? "Unknown",
  ticketQty: txn.ticketQty,
  totalPaid: txn.finalPrice,
  status: txn.status,
  createdAt: txn.createdAt.toISOString(),
});

/**
 * Maps an Attendee (with relations) to a safe AttendeeDTO.
 */
export const mapAttendeeToDTO = (attendee: any): AttendeeDTO => ({
  id: attendee.id,
  attendeeName: attendee.user?.name ?? "Unknown",
  email: attendee.user?.email ?? "Unknown",
  event: attendee.event?.title ?? "Unknown",
  ticketType: attendee.ticketType?.name ?? "Unknown",
  checkedIn: attendee.checkedIn,
  checkedInAt: attendee.checkedInAt?.toISOString() ?? null,
  buyerName: attendee.transaction?.user?.name ?? "Unknown",
  totalPaid: attendee.transaction?.finalPrice ?? 0,
});
