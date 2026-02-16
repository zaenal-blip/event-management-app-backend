import { Response } from "express";
import { DashboardService } from "./dashboard.service.js";
import { AuthRequest } from "../../middleware/auth.middleware.js";
import { PrismaClient } from "../../generated/prisma/client.js";

export class DashboardController {
  constructor(
    private dashboardService: DashboardService,
    private prisma: PrismaClient,
  ) {}

  private getOrganizerId = async (userId: number): Promise<number | null> => {
    const organizer = await this.prisma.organizer.findUnique({
      where: { userId },
      select: { id: true },
    });
    return organizer?.id ?? null;
  };

  private parseDateRange = (
    query: any,
  ): { startDate?: Date; endDate?: Date } => {
    const startDate = query.startDate
      ? new Date(query.startDate as string)
      : undefined;
    const endDate = query.endDate
      ? new Date(query.endDate as string)
      : undefined;

    // Validate dates
    if (startDate && isNaN(startDate.getTime())) return {};
    if (endDate && isNaN(endDate.getTime())) return {};

    return { startDate, endDate };
  };

  getSummary = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const organizerId = await this.getOrganizerId(req.user.id);
    if (!organizerId) {
      return res
        .status(403)
        .send({ message: "You are not registered as an organizer" });
    }

    const { startDate, endDate } = this.parseDateRange(req.query);
    const result = await this.dashboardService.getSummary(
      organizerId,
      startDate,
      endDate,
    );
    res.status(200).send(result);
  };

  getAnalytics = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const organizerId = await this.getOrganizerId(req.user.id);
    if (!organizerId) {
      return res
        .status(403)
        .send({ message: "You are not registered as an organizer" });
    }

    const { startDate, endDate } = this.parseDateRange(req.query);
    const result = await this.dashboardService.getAnalytics(
      organizerId,
      startDate,
      endDate,
    );
    res.status(200).send(result);
  };
}
