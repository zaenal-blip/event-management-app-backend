import { PrismaClient, User } from "../../generated/prisma/client.js";
import { comparePassword, hashPassword } from "../../lib/argon.js";
import { ApiError } from "../../utils/api-error.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { CreateUserBody } from "../../types/user.js";
import { MailService } from "../mail/mail.service.js";

const generateReferralCode = () => {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
};

export class AuthService {
  constructor(
    private prisma: PrismaClient,
    private mailService: MailService,
  ) { }

  register = async (body: CreateUserBody) => {
    //1. Cek avaibilitas email
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
    });
    //2. Kalau sudah dipakai throw error
    if (user) {
      throw new ApiError("Email Already Exist", 400);
    }

    //3. Lookup referrer if referralCode is provided
    let referredByUserId: number | null = null;
    if (body.referralCode) {
      const referrer = await this.prisma.user.findFirst({
        where: { referralCode: body.referralCode },
      });

      if (!referrer) {
        throw new ApiError("Referral code not found", 400);
      }
      referredByUserId = referrer.id;
    }

    //4. Hash Password dari body.password
    const hashedPassword = await hashPassword(body.password);

    //5. Generate Unique Referral Code for new user
    let newReferralCode: string;
    let isCodeUnique = false;
    do {
      newReferralCode = generateReferralCode();
      const existingCode = await this.prisma.user.findFirst({
        where: { referralCode: newReferralCode },
      });
      if (!existingCode) isCodeUnique = true;
    } while (!isCodeUnique);

    //6. Create user baru
    //6. Create user baru (dengan transaction untuk organizer)
    const newUser = await this.prisma.$transaction(async (tx) => {
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

      // If role is ORGANIZER, create organizer profile
      if (body.role === "ORGANIZER") {
        await tx.organizer.create({
          data: {
            userId: user.id,
            name: "",
          },
        });
      }

      return user;
    });

    //7. If referred, reward referrer and new user
    if (referredByUserId) {
      // Award points to referrer
      await this.prisma.point.create({
        data: {
          userId: referredByUserId,
          amount: 10000,
          description: "Referral Reward",
          type: "EARNED",
          expiredAt: new Date(new Date().setMonth(new Date().getMonth() + 3)),
        },
      });

      await this.prisma.user.update({
        where: { id: referredByUserId },
        data: { point: { increment: 10000 } },
      });

      // Create coupon for new user
      await this.prisma.coupon.create({
        data: {
          userId: newUser.id,
          code: `REF-${newReferralCode}`,
          discountAmount: 50000,
          expiredAt: new Date(new Date().setMonth(new Date().getMonth() + 1)),
        },
      });
    }

    //8. Send welcome email
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    await this.mailService.sendEmail(
      newUser.email,
      "Welcome to Eventku! 🎉",
      "welcome",
      {
        name: newUser.name,
        referralCode: newReferralCode,
        exploreLink: `${baseUrl}/events`,
      },
    );

    //9. Return Message Register Success
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

    return user;
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
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
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
