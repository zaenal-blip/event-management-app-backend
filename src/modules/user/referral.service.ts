import { PrismaClient } from "../../generated/prisma/client.js";
import { ApiError } from "../../utils/api-error.js";
import {
  calculateUserPointBalance,
  getExpiringPoints,
} from "../../utils/point.utils.js";

export class ReferralService {
  constructor(private prisma: PrismaClient) {}

  getReferralRewardsData = async (userId: number, role: string) => {
    // 1. Validate Role
    if (role !== "CUSTOMER") {
      throw new ApiError(
        "Referral system is only available for customers",
        403,
      );
    }

    // 2. Fetch User Data (Referral Code)
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    // 3. Count Total Successful Referrals
    const totalReferrals = await this.prisma.user.count({
      where: { referredByUserId: userId },
    });

    // 4. Calculate Active Points
    // Use the robust FIFO calculation from utils to ensure expired points are handled correctly
    // matching the logic used in transaction creation.
    const totalPoints = await calculateUserPointBalance(userId, this.prisma);

    // 5. Fetch Points History
    const pointsHistory = await this.prisma.point.findMany({
      where: { userId: userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        amount: true,
        description: true,
        expiredAt: true,
        createdAt: true,
        type: true,
      },
      take: 20, // Limit history to recent 20 items
    });

    // 6. Fetch Active Coupons
    // Coupons that are NOT used AND NOT expired
    const coupons = await this.prisma.coupon.findMany({
      where: {
        userId: userId,
        isUsed: false,
        expiredAt: { gt: new Date() },
      },
      select: {
        id: true,
        code: true,
        discountAmount: true,
        expiredAt: true,
      },
      orderBy: { expiredAt: "asc" },
    });

    // Add isExpiringSoon flag (within 7 days)
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const formattedCoupons = coupons.map((coupon) => ({
      ...coupon,
      isExpiringSoon: coupon.expiredAt < sevenDaysFromNow,
    }));

    // 7. Get Expiring Points Warning
    const { expiringAmount, nearestExpiryDate } = await getExpiringPoints(
      userId,
      this.prisma,
    );

    return {
      referralCode: user.referralCode,
      totalReferrals,
      totalPoints,
      pointsHistory: pointsHistory.map((p) => ({
        ...p,
        isExpired:
          p.type === "EARNED" && p.expiredAt && p.expiredAt < new Date(),
      })),
      coupons: formattedCoupons,
      pointsExpiringSoon: expiringAmount,
      pointsExpiryDate: nearestExpiryDate,
    };
  };
}
