import { PaginationQueryParams } from "./pagination.js";

export interface CreateEventBody {
  title: string;
  description: string;
  image?: string;
  category: string;
  location: string;
  venue: string;
  startDate: string; // ISO string
  endDate: string; // ISO string
  ticketTypes: CreateTicketTypeBody[];
}

export interface CreateTicketTypeBody {
  name: string;
  description: string;
  price: number;
  totalSeat: number;
}

export interface CreateVoucherBody {
  code: string;
  discountAmount: number;
  discountType: "PERCENTAGE" | "FIXED";
  startDate: string; // ISO string
  endDate: string; // ISO string
  usageLimit: number;
}

export interface GetEventsQuery extends PaginationQueryParams {
  search?: string;
  category?: string;
  location?: string;
  priceRange?: "all" | "free" | "paid";
  startDate?: string;
  endDate?: string;
}
