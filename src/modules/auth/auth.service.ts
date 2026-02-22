import { PrismaClient, User } from "../../generated/prisma/client.js";
import { comparePassword, hashPassword } from "../../lib/argon.js";
import { ApiError } from "../../utils/api-error.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { CreateUserBody } from "../../types/user.js";
import { MailService } from "../mail/mail.service.js";
import {
  calculateUserPointBalance,
  getExpiringPoints,
} from "../../utils/point.utils.js";

const generateReferralCode = () => {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
};

export class AuthService {
  constructor(
    private prisma: PrismaClient,
    private mailService: MailService,
  ) { }

  register = async (body: CreateUserBody) => {
    // 1. Cek avaibilitas email
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
    });
    // 2. Kalau sudah dipakai throw error
    if (user) {
      throw new ApiError("Email Already Exist", 400);
    }

    // 3. Lookup referrer if referralCode is provided AND role is CUSTOMER
    let referredByUserId: number | null = null;
    if (body.role === "CUSTOMER" && body.referralCode) {
      const referrer = await this.prisma.user.findFirst({
        where: { referralCode: body.referralCode },
      });

      if (!referrer) {
        throw new ApiError("Referral code not found", 400);
      }

      // Check if referrer is an organizer
      if (referrer.role === "ORGANIZER") {
        throw new ApiError("Referral code not valid", 400);
      }

      referredByUserId = referrer.id;
    }

    // 4. Hash Password dari body.password
    const hashedPassword = await hashPassword(body.password);

    // 5. Generate Unique Referral Code ONLY for CUSTOMER
    let newReferralCode: string | null = null;
    if (body.role === "CUSTOMER") {
      let isCodeUnique = false;
      do {
        newReferralCode = generateReferralCode();
        const existingCode = await this.prisma.user.findFirst({
          where: { referralCode: newReferralCode },
        });
        if (!existingCode) isCodeUnique = true;
      } while (!isCodeUnique);
    }

    // 6. Execute Transaction (Atomic Operation)
    const result = await this.prisma.$transaction(async (tx) => {
      // 6a. Create User
      const user = await tx.user.create({
        data: {
          name: body.name,
          email: body.email,
          password: hashedPassword,
          role: body.role,
          referralCode: newReferralCode,
          referredByUserId: referredByUserId,
          point: 0,
          avatar: body.avatar,
        },
      });

      // 6b. Create Organizer Profile if needed
      if (body.role === "ORGANIZER") {
        await tx.organizer.create({
          data: {
            userId: user.id,
            name: body.name,
          },
        });
      }

      // 6c. Handle Referral Rewards (Points & Coupon)
      if (body.role === "CUSTOMER" && referredByUserId && newReferralCode) {
        // Award points to referrer
        await tx.point.create({
          data: {
            userId: referredByUserId,
            amount: 10000,
            description: "Referral Reward",
            type: "EARNED",
            expiredAt: new Date(new Date().setMonth(new Date().getMonth() + 3)),
          },
        });

        await tx.user.update({
          where: { id: referredByUserId },
          data: { point: { increment: 10000 } },
        });

        // Create coupon for new user
        let newCouponCode: string;
        let isCouponUnique = false;

        // Generate unique coupon code (WELCOME-XXXXXX)
        // Note: For high concurrency, pre-checking inside transaction is safer but might lock
        // Here we do a best-effort generation inside transaction
        do {
          const randomStr = crypto.randomBytes(3).toString("hex").toUpperCase();
          newCouponCode = `WELCOME-${randomStr}`;

          // Check against DB inside transaction to be sure
          const existingCoupon = await tx.coupon.findFirst({
            where: { code: newCouponCode },
          });

          if (!existingCoupon) isCouponUnique = true;
        } while (!isCouponUnique);

        const couponExpiredAt = new Date();
        couponExpiredAt.setMonth(couponExpiredAt.getMonth() + 3);

        await tx.coupon.create({
          data: {
            userId: user.id,
            code: newCouponCode,
            discountAmount: 50000,
            expiredAt: couponExpiredAt,
          },
        });
      }

      return user;
    });

    // 7. Send Welcome Email (After Transaction Commits)
    // If email fails, user is still created. This is acceptable.
    // We wrap in try-catch to prevent crashing the response.
    try {
      const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      if (result.role === "ORGANIZER") {
        await this.mailService.sendEmail(
          result.email,
          "Welcome to Eventku – Your Organizer Account is Ready",
          "welcome-organizer",
          {
            name: result.name,
            dashboardLink: `${baseUrl}/dashboard`,
            year: new Date().getFullYear(),
          },
        );
      } else {
        await this.mailService.sendEmail(
          result.email,
          "Welcome to Eventku! 🎉",
          "welcome",
          {
            name: result.name,
            referralCode: result.referralCode,
            exploreLink: `${baseUrl}/events`,
          },
        );
      }
    } catch (error) {
      console.error("Failed to send welcome email:", error);
      // We do NOT throw here, as registration was successful
    }

    return { message: "Register Success" };
  };

  login = async (body: Pick<User, "email" | "password">) => {
    //1. Cek Emailnya ada ga
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
    });
    //2. Kalo ga ada, throw error
    if (!user) {
      throw new ApiError("Invalid Credential", 400);
    }
    //3. Cek Passwordnya ada ga
    const isPassMatch = await comparePassword(body.password, user.password);
    //4. Kalo ga ada, throw error
    if (!isPassMatch) {
      throw new ApiError("Invalid Credential", 400);
    }
    //5. Generate Token dengan jwt->jsonwebtoken
    const payload = { id: user.id, role: user.role };
    const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: "15m",
    });
    const refreshToken = jwt.sign(payload, process.env.JWT_SECRET_REFRESH!, {
      expiresIn: "3d",
    });

    await this.prisma.refreshToken.upsert({
      where: {
        userId: user.id,
      },
      update: {
        token: refreshToken,
        expiredAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
      create: {
        token: refreshToken,
        userId: user.id,
        expiredAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
    });
    //6. Return data usernya
    const { password, ...userWithoutPassword } = user;
    return { ...userWithoutPassword, accessToken, refreshToken };
  };

  logout = async (refreshToken?: string) => {
    if (!refreshToken) {
      throw new ApiError("Invalid refresh token", 400);
    }
    await this.prisma.refreshToken.delete({
      where: {
        token: refreshToken,
      },
    });
    return { message: "Logout success" };
  };

  refresh = async (refreshToken?: string) => {
    if (!refreshToken) {
      throw new ApiError("Invalid refresh token", 400);
    }
    const stored = await this.prisma.refreshToken.findUnique({
      where: {
        token: refreshToken,
      },
      include: {
        user: true,
      },
    });
    if (!stored) {
      throw new ApiError("Refresh token not found", 400);
    }

    if (stored.expiredAt < new Date()) {
      throw new ApiError("Refresh token expired", 400);
    }

    const payload = {
      id: stored.user.id,
      role: stored.user.role,
    };
    const newAccessToken = jwt.sign(payload, process.env.JWT_SECRET!, {
      expiresIn: "15m",
    });
    return {
      accessToken: newAccessToken,
    };
  };

  getProfile = async (userId: number) => {
    // 1. Calculate actual valid points
    const validPoints = await calculateUserPointBalance(userId, this.prisma);

    // 2. Update user profile if different (Sync DB)
    // We do this so other simple queries can still rely on user.point for approximation
    // But critical logic should always calculate.
    await this.prisma.user.update({
      where: { id: userId },
      data: { point: validPoints },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      omit: { password: true },
      include: {
        points: {
          orderBy: { createdAt: "desc" },
          take: 10, // Recent point history
        },
      },
    });

    if (!user) {
      throw new ApiError("User not found", 404);
    }

    // 3. Get expiring points warning
    const { expiringAmount, nearestExpiryDate } = await getExpiringPoints(
      userId,
      this.prisma,
    );

    // Ensure returned user has the calculated points (in case update race condition, though unlikely)
    // We append the extra fields for the frontend warning
    return {
      ...user,
      point: validPoints, // Ensure this uses the calculated valid balance
      pointsExpiringSoon: expiringAmount,
      pointsExpiryDate: nearestExpiryDate,
    };
  };

  /**
   * Forgot Password - Send reset link to email
   * Always returns generic message to prevent email enumeration
   */
  forgotPassword = async (email: string) => {
    const user = await this.prisma.user.findUnique({
      where: { email, deletedAt: null },
    });

    // Generic response even if email doesn't exist (security)
    if (!user) {
      return {
        message: "If your email is registered, you will receive a reset link",
      };
    }

    // Generate secure random token
    const rawToken = crypto.randomBytes(32).toString("hex");
    // Hash token before storing (security best practice)
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    // Set expiry to 1 hour from now
    const expiredAt = new Date(Date.now() + 60 * 60 * 1000);

    // Store hashed token in DB
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash,
        expiredAt,
      },
    });

    // Build reset link (raw token sent to user)
    const baseUrl = process.env.BASE_URL_FE;
    const resetLink = `${baseUrl}/reset-password?token=${rawToken}`;

    // Send email (wrapped in try-catch to prevent revealing if email exists)
    try {
      await this.mailService.sendEmail(
        user.email,
        "Reset Your Password - Eventku",
        "forgot-pass",
        {
          name: user.name,
          resetLink,
        },
      );
    } catch (error) {
      // Log error but don't expose to user (security)
    }

    return {
      message: "If your email is registered, you will receive a reset link",
    };
  };

  /**
   * Reset Password - Validate token and update password
   */
  resetPassword = async (token: string, newPassword: string) => {
    // Hash the provided token to match against stored hash
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find valid token (not expired, not used)
    const passwordReset = await this.prisma.passwordReset.findFirst({
      where: {
        tokenHash,
        expiredAt: { gt: new Date() },
        usedAt: null,
      },
      include: { user: true },
    });

    if (!passwordReset) {
      throw new ApiError("Invalid or expired reset token", 400);
    }

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update password and mark token as used (transaction)
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: passwordReset.userId },
        data: { password: hashedPassword },
      }),
      this.prisma.passwordReset.update({
        where: { id: passwordReset.id },
        data: { usedAt: new Date() },
      }),
    ]);

    // Send notification email
    const now = new Date();
    await this.mailService.sendEmail(
      passwordReset.user.email,
      "Your Password Was Changed - Eventku",
      "password-changed",
      {
        name: passwordReset.user.name,
        date: now.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        time: now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    );

    return { message: "Password reset successfully" };
  };
}
