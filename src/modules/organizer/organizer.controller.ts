import { Response } from "express";
import { OrganizerService } from "./organizer.service.js";
import { AuthRequest } from "../../middleware/auth.middleware.js";

export class OrganizerController {
  constructor(private organizerService: OrganizerService) {}

  /**
   * GET /organizer/buyers
   * Query: page, limit, eventId, search
   */
  getBuyers = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }
    if (req.user.role !== "ORGANIZER") {
      return res.status(403).send({ message: "Forbidden" });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const eventId = req.query.eventId ? Number(req.query.eventId) : undefined;
    const search = (req.query.search as string) || undefined;

    const result = await this.organizerService.getBuyers(req.user.id, {
      page,
      limit,
      eventId,
      search,
    });
    res.status(200).send(result);
  };

  /**
   * GET /organizer/attendees
   * Query: page, limit, eventId, status, search
   */
  getAttendees = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }
    if (req.user.role !== "ORGANIZER") {
      return res.status(403).send({ message: "Forbidden" });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const eventId = req.query.eventId ? Number(req.query.eventId) : undefined;
    const search = (req.query.search as string) || undefined;

    const statusParam = req.query.status as string | undefined;
    const status =
      statusParam === "checked_in" || statusParam === "registered"
        ? statusParam
        : undefined;

    const result = await this.organizerService.getAttendees(req.user.id, {
      page,
      limit,
      eventId,
      status,
      search,
    });
    res.status(200).send(result);
  };

  /**
   * GET /organizer/events
   * Returns list of organizer's events for filter dropdowns.
   */
  getEvents = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }
    if (req.user.role !== "ORGANIZER") {
      return res.status(403).send({ message: "Forbidden" });
    }

    const events = await this.organizerService.getOrganizerEvents(req.user.id);
    res.status(200).send(events);
  };

  /**
   * GET /organizer/buyers/export
   * Returns CSV file of all buyers.
   */
  exportBuyersCSV = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }
    if (req.user.role !== "ORGANIZER") {
      return res.status(403).send({ message: "Forbidden" });
    }

    const csv = await this.organizerService.exportBuyersCSV(req.user.id);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="buyers-${Date.now()}.csv"`,
    );
    res.status(200).send(csv);
  };

  /**
   * GET /organizer/attendees/export
   * Returns CSV file of all attendees.
   */
  exportAttendeesCSV = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }
    if (req.user.role !== "ORGANIZER") {
      return res.status(403).send({ message: "Forbidden" });
    }

    const csv = await this.organizerService.exportAttendeesCSV(req.user.id);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="attendees-${Date.now()}.csv"`,
    );
    res.status(200).send(csv);
  };
}
