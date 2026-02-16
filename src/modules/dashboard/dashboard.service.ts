import { PrismaClient } from "../../generated/prisma/client.js";

export class DashboardService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get dashboard summary for an organizer.
   * Accepts optional startDate/endDate for date-range filtering.
   */
  getSummary = async (
    organizerId: number,
    startDate?: Date,
    endDate?: Date,
  ) => {
    // Default: last 7 days if no range given
    const now = new Date();
    const effectiveEnd = endDate ?? now;
    const effectiveStart =
      startDate ?? new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    effectiveStart.setHours(0, 0, 0, 0);
    effectiveEnd.setHours(23, 59, 59, 999);

    // 1. Total events for this organizer
    const totalEvents = await this.prisma.event.count({
      where: { organizerId },
    });

    // 2. Get all event IDs for this organizer
    const organizerEventIds = await this.prisma.event.findMany({
      where: { organizerId },
      select: { id: true },
    });
    const eventIds = organizerEventIds.map((e) => e.id);

    // Date filter for transactions
    const dateFilter = {
      gte: effectiveStart,
      lte: effectiveEnd,
    };

    // 3. Transaction aggregates within date range
    const [totalTransactions, pendingConfirmations, revenueAgg] =
      await Promise.all([
        this.prisma.transaction.count({
          where: { eventId: { in: eventIds }, createdAt: dateFilter },
        }),
        this.prisma.transaction.count({
          where: {
            eventId: { in: eventIds },
            status: "WAITING_CONFIRMATION",
            createdAt: dateFilter,
          },
        }),
        this.prisma.transaction.aggregate({
          where: {
            eventId: { in: eventIds },
            status: "DONE",
            createdAt: dateFilter,
          },
          _sum: { finalPrice: true },
        }),
      ]);

    const totalRevenue = revenueAgg._sum.finalPrice ?? 0;

    // 4. Monthly revenue chart within the date range
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const recentTransactions = await this.prisma.transaction.findMany({
      where: {
        eventId: { in: eventIds },
        status: "DONE",
        createdAt: dateFilter,
      },
      select: {
        finalPrice: true,
        ticketQty: true,
        createdAt: true,
      },
    });

    // Build monthly map for the range
    const monthlyMap: Record<string, { revenue: number; tickets: number }> = {};
    const cursor = new Date(
      effectiveStart.getFullYear(),
      effectiveStart.getMonth(),
      1,
    );
    while (cursor <= effectiveEnd) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth()).padStart(2, "0")}`;
      monthlyMap[key] = { revenue: 0, tickets: 0 };
      cursor.setMonth(cursor.getMonth() + 1);
    }

    for (const txn of recentTransactions) {
      const key = `${txn.createdAt.getFullYear()}-${String(txn.createdAt.getMonth()).padStart(2, "0")}`;
      if (monthlyMap[key]) {
        monthlyMap[key].revenue += txn.finalPrice;
        monthlyMap[key].tickets += txn.ticketQty;
      }
    }

    const revenueChart = Object.entries(monthlyMap).map(([key, data]) => {
      const month = parseInt(key.split("-")[1]);
      return {
        name: monthNames[month],
        revenue: data.revenue,
        tickets: data.tickets,
      };
    });

    return {
      totalEvents,
      totalRevenue,
      totalTransactions,
      pendingConfirmations,
      revenueChart,
    };
  };

  /**
   * Get analytics data for an organizer.
   * Accepts optional startDate/endDate for date-range filtering.
   */
  getAnalytics = async (
    organizerId: number,
    startDate?: Date,
    endDate?: Date,
  ) => {
    const now = new Date();
    const effectiveEnd = endDate ?? now;
    const effectiveStart =
      startDate ??
      (() => {
        const d = new Date(now);
        d.setMonth(d.getMonth() - 5);
        d.setDate(1);
        return d;
      })();
    effectiveStart.setHours(0, 0, 0, 0);
    effectiveEnd.setHours(23, 59, 59, 999);

    const organizerEventIds = await this.prisma.event.findMany({
      where: { organizerId },
      select: { id: true },
    });
    const eventIds = organizerEventIds.map((e) => e.id);

    const dateFilter = {
      gte: effectiveStart,
      lte: effectiveEnd,
    };

    // 1. Monthly revenue within date range
    const monthlyTransactions = await this.prisma.transaction.findMany({
      where: {
        eventId: { in: eventIds },
        status: "DONE",
        createdAt: dateFilter,
      },
      select: {
        finalPrice: true,
        ticketQty: true,
        createdAt: true,
      },
    });

    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    // Build month map from start to end
    const monthlyMap: Record<string, { revenue: number; tickets: number }> = {};
    const cursor = new Date(
      effectiveStart.getFullYear(),
      effectiveStart.getMonth(),
      1,
    );
    while (cursor <= effectiveEnd) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth()).padStart(2, "0")}`;
      monthlyMap[key] = { revenue: 0, tickets: 0 };
      cursor.setMonth(cursor.getMonth() + 1);
    }

    for (const txn of monthlyTransactions) {
      const key = `${txn.createdAt.getFullYear()}-${String(txn.createdAt.getMonth()).padStart(2, "0")}`;
      if (monthlyMap[key]) {
        monthlyMap[key].revenue += txn.finalPrice;
        monthlyMap[key].tickets += txn.ticketQty;
      }
    }

    const monthlyRevenue = Object.entries(monthlyMap).map(([key, data]) => {
      const month = parseInt(key.split("-")[1]);
      return {
        name: monthNames[month],
        revenue: data.revenue,
        tickets: data.tickets,
      };
    });

    // 2. Category distribution within date range
    const categoryTransactions = await this.prisma.transaction.findMany({
      where: {
        eventId: { in: eventIds },
        status: "DONE",
        createdAt: dateFilter,
      },
      select: {
        ticketQty: true,
        event: { select: { category: true } },
      },
    });

    const categoryMap: Record<string, number> = {};
    for (const txn of categoryTransactions) {
      const cat = txn.event.category || "Other";
      categoryMap[cat] = (categoryMap[cat] || 0) + txn.ticketQty;
    }

    const categoryDistribution = Object.entries(categoryMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // 3. Top events within date range
    const topEventsData = await this.prisma.transaction.groupBy({
      by: ["eventId"],
      where: {
        eventId: { in: eventIds },
        status: "DONE",
        createdAt: dateFilter,
      },
      _sum: { ticketQty: true },
      orderBy: { _sum: { ticketQty: "desc" } },
      take: 5,
    });

    const topEventIds = topEventsData.map((e) => e.eventId);
    const topEventDetails = await this.prisma.event.findMany({
      where: { id: { in: topEventIds } },
      select: { id: true, title: true },
    });
    const eventNameMap = Object.fromEntries(
      topEventDetails.map((e) => [e.id, e.title]),
    );

    const topEvents = topEventsData.map((e) => ({
      name: eventNameMap[e.eventId] || `Event #${e.eventId}`,
      tickets: e._sum.ticketQty ?? 0,
    }));

    return {
      monthlyRevenue,
      categoryDistribution,
      topEvents,
    };
  };
}
