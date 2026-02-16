import { PrismaClient } from "../generated/prisma/client.js";

export const calculateUserPointBalance = async (
  userId: number,
  prisma: PrismaClient,
) => {
  // 1. Get all EARNED points (FIFO order)
  const earnedPoints = await prisma.point.findMany({
    where: {
      userId,
      type: "EARNED",
    },
    orderBy: { createdAt: "asc" },
  });

  // 2. Get total USED points (amount is negative, so we take absolute)
  const usedPoints = await prisma.point.aggregate({
    where: {
      userId,
      type: "USED",
    },
    _sum: { amount: true },
  });

  let totalUsed = Math.abs(usedPoints._sum.amount || 0);
  let currentBalance = 0;
  const now = new Date();

  // 3. FIFO Consumption Logic
  for (const point of earnedPoints) {
    let available = point.amount;

    if (totalUsed > 0) {
      const consumed = Math.min(available, totalUsed);
      available -= consumed;
      totalUsed -= consumed;
    }

    // Only add to balance if:
    // a) There is remaining amount
    // b) The point has NOT expired
    if (available > 0) {
      if (!point.expiredAt || point.expiredAt > now) {
        currentBalance += available;
      }
    }
  }

  return currentBalance;
};

export const getExpiringPoints = async (
  userId: number,
  prisma: PrismaClient,
  days: number = 7,
) => {
  // 1. Get all EARNED points (FIFO order)
  const earnedPoints = await prisma.point.findMany({
    where: {
      userId,
      type: "EARNED",
    },
    orderBy: { createdAt: "asc" },
  });

  // 2. Get total USED points
  const usedPoints = await prisma.point.aggregate({
    where: {
      userId,
      type: "USED",
    },
    _sum: { amount: true },
  });

  let totalUsed = Math.abs(usedPoints._sum.amount || 0);
  let expiringAmount = 0;
  let nearestExpiryDate: Date | null = null;
  const now = new Date();
  const warningThreshold = new Date();
  warningThreshold.setDate(now.getDate() + days);

  // 3. FIFO Logic to find remaining points and check expiry
  for (const point of earnedPoints) {
    let available = point.amount;

    if (totalUsed > 0) {
      const consumed = Math.min(available, totalUsed);
      available -= consumed;
      totalUsed -= consumed;
    }

    if (available > 0) {
      // Check if this point batch is expiring soon (including today)
      // Logic: expiredAt is NOT NULL AND expiredAt <= warningThreshold AND expiredAt > now (not already expired)
      if (
        point.expiredAt &&
        point.expiredAt > now &&
        point.expiredAt <= warningThreshold
      ) {
        expiringAmount += available;
        if (!nearestExpiryDate || point.expiredAt < nearestExpiryDate) {
          nearestExpiryDate = point.expiredAt;
        }
      }
    }
  }

  return { expiringAmount, nearestExpiryDate };
};
