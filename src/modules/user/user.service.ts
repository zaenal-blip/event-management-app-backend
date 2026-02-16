import { Prisma, PrismaClient, User } from "../../generated/prisma/client.js";
import { PaginationQueryParams } from "../../types/pagination.js";
import { CreateUserBody } from "../../types/user.js";
import { ApiError } from "../../utils/api-error.js";
import { comparePassword, hashPassword } from "../../lib/argon.js";
import { calculateUserPointBalance } from "../../utils/point.utils.js";
import { CloudinaryService } from "../cloudinary/cloudinary.service.js";
import { MailService } from "../mail/mail.service.js";

interface GetUsersQuery extends PaginationQueryParams {
  search: string;
}

export class UserService {
  constructor(
    private prisma: PrismaClient,
    private cloudinaryService: CloudinaryService,
    private mailService: MailService,
  ) {}

  getUsers = async (query: GetUsersQuery) => {
    const { page, sortBy, sortOrder, take, search } = query;

    const whereClause: Prisma.UserWhereInput = {
      deletedAt: null,
    };

    if (search) {
      whereClause.name = { contains: search, mode: "insensitive" };
    }

    const users = await this.prisma.user.findMany({
      where: whereClause,
      take: take,
      skip: (page - 1) * take,
      orderBy: { [sortBy]: sortOrder },
      omit: { password: true },
    });

    const total = await this.prisma.user.count({ where: whereClause });

    return {
      data: users,
      meta: { page, take, total },
    };
  };

  getUser = async (id: number) => {
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      omit: { password: true },
    });

    if (!user) throw new ApiError("User not found", 404);

    // Sync points for CUSTOMER
    if (user.role === "CUSTOMER") {
      const calculatedPoints = await calculateUserPointBalance(
        user.id,
        this.prisma,
      );

      if (calculatedPoints !== user.point) {
        // Update the user's point in the database to match the calculated balance
        const updatedUser = await this.prisma.user.update({
          where: { id },
          data: { point: calculatedPoints },
          omit: { password: true },
        });
        return updatedUser;
      }
    }

    return user;
  };

  createUser = async (body: CreateUserBody) => {
    await this.prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        password: body.password,
        role: body.role,
        referralCode: body.referralCode,
        point: body.point,
        avatar: body.avatar,
      },
    });

    return { message: "create user success" };
  };

  updateUser = async (id: number, body: Partial<User>) => {
    await this.getUser(id);

    if (body.email) {
      const userEmail = await this.prisma.user.findUnique({
        where: { email: body.email },
      });

      if (userEmail) throw new ApiError("email already exist", 400);
    }

    await this.prisma.user.update({
      where: { id },
      data: body,
    });

    return { message: "update user success" };
  };

  /**
   * Update user password
   * - Verify old password matches current hashed password in database
   * - If match, hash new password and update
   */
  updatePassword = async (
    id: number,
    body: { oldPassword: string; newPassword: string },
  ) => {
    // Get user with password (we need the password for comparison)
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
    });

    if (!user) throw new ApiError("User not found", 404);

    // Verify old password matches current password
    const isOldPasswordValid = await comparePassword(
      body.oldPassword,
      user.password,
    );

    if (!isOldPasswordValid) {
      throw new ApiError("Old password is incorrect", 400);
    }

    // Verify new password is not the same as old password
    if (body.newPassword === body.oldPassword) {
      throw new ApiError(
        "New password cannot be the same as old password",
        400,
      );
    }

    // Hash new password
    const hashedNewPassword = await hashPassword(body.newPassword);

    // Update password in database
    await this.prisma.user.update({
      where: { id },
      data: { password: hashedNewPassword },
    });

    // Send email notification
    const now = new Date();
    await this.mailService.sendEmail(
      user.email,
      "Your Password Was Changed - Eventku",
      "password-changed",
      {
        name: user.name,
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

    return { message: "Password updated successfully" };
  };

  /**
   * Update user profile (name, email, phone)
   */
  updateProfile = async (
    id: number,
    body: { name?: string; email?: string; phone?: string; avatar?: string },
  ) => {
    await this.getUser(id);

    // If email is being updated, check if it's already taken by another user
    if (body.email) {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          email: body.email,
          id: { not: id }, // Exclude current user
        },
      });

      if (existingUser) {
        throw new ApiError("Email already taken", 400);
      }
    }

    // If phone is being updated, check if it's already taken by another user
    if (body.phone) {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          phone: body.phone,
          id: { not: id }, // Exclude current user
        },
      });

      if (existingUser) {
        throw new ApiError("Phone number already taken", 400);
      }
    }

    // Build update data object with only provided fields
    const updateData: {
      name?: string;
      email?: string;
      phone?: string;
      avatar?: string;
    } = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.avatar !== undefined) updateData.avatar = body.avatar;

    // Check if avatar is being updated and remove old one from Cloudinary
    if (body.avatar && body.avatar !== (await this.getUser(id)).avatar) {
      const currentUser = await this.getUser(id);
      if (currentUser.avatar) {
        await this.cloudinaryService.removeByUrl(currentUser.avatar);
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: updateData,
      omit: { password: true },
    });

    return { ...updatedUser, message: "Profile updated successfully" };
  };

  /**
   * Update organizer profile
   */
  updateOrganizerProfile = async (
    userId: number,
    body: {
      brandName: string;
      description?: string;
      contactInfo?: string;
      notificationEmail?: string;
      publicProfileVisible?: boolean;
      defaultMinPurchase?: number;
      defaultVoucherValidityDays?: number;
      logo?: string; // from avatar upload in frontend logic, but mapped to avatar in checks
    },
  ) => {
    const user = await this.getUser(userId);

    if (user.role !== "ORGANIZER") {
      throw new ApiError("User is not an organizer", 403);
    }

    // Check if organizer profile exists, if not create it (auto-fix consistency)
    let organizer = await this.prisma.organizer.findUnique({
      where: { userId },
    });

    // Handle logo update (similar to avatar)
    // If a new logo is provided, we might need to delete old one if logic requires
    // For now, we assume frontend handles upload and sends URL

    // Prepare update data
    const updateData: any = {
      name: body.brandName,
      bio: body.description,
      contactInfo: body.contactInfo,
      notificationEmail: body.notificationEmail,
      publicProfileVisible: body.publicProfileVisible,
      defaultMinPurchase: body.defaultMinPurchase,
      defaultVoucherValidityDays: body.defaultVoucherValidityDays,
    };

    if (body.logo) {
      updateData.avatar = body.logo; // Map logo to avatar field in Organizer model
      // Check if logo is being updated and remove old one from Cloudinary
      if (organizer?.avatar && organizer.avatar !== body.logo) {
        await this.cloudinaryService.removeByUrl(organizer.avatar);
      }
    }

    if (!organizer) {
      // Create new if missing
      organizer = await this.prisma.organizer.create({
        data: {
          userId,
          name: body.brandName || user.name, // Fallback
          ...updateData,
        },
      });
    } else {
      // Update existing
      organizer = await this.prisma.organizer.update({
        where: { userId },
        data: updateData,
      });
    }

    return { ...organizer, message: "Organizer profile updated successfully" };
  };

  /**
   * Get organizer profile
   */
  getOrganizerProfile = async (userId: number) => {
    return await this.prisma.organizer.findUnique({
      where: { userId },
    });
  };

  deleteUser = async (id: number) => {
    await this.getUser(id);

    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { message: "delete user success" };
  };
}
