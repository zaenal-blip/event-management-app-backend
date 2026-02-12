import axios from "axios";
import crypto from "crypto";
import FormData from "form-data";

export class CloudinaryService {
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor() {
    this.cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
    this.apiKey = process.env.CLOUDINARY_API_KEY!;
    this.apiSecret = process.env.CLOUDINARY_API_SECRET!;
  }

  /**
   * Generate Cloudinary signature (SHA1)
   */
  private generateSignature(params: Record<string, string | number>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");

    return crypto
      .createHash("sha1")
      .update(sortedParams + this.apiSecret)
      .digest("hex");
  }

  /**
   * Upload image using SIGNED request (secure)
   */
  async upload(file: Express.Multer.File) {
    const timestamp = Math.floor(Date.now() / 1000);

    const params: Record<string, string | number> = {
      timestamp,
    };

    const signature = this.generateSignature(params);

    const formData = new FormData();
    formData.append("file", file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    formData.append("api_key", this.apiKey);
    formData.append("timestamp", timestamp.toString());
    formData.append("signature", signature);

    const response = await axios.post(
      `https://api.cloudinary.com/v1_1/${this.cloudName}/image/upload`,
      formData,
      { headers: formData.getHeaders() },
    );

    return response.data;
  }

  /**
   * Extract public_id from secure_url
   * https://res.cloudinary.com/.../image/upload/v1234/blog/abc.jpg
   */
  private extractPublicIdFromUrl(url: string): string {
    const withoutQuery = url.split("?")[0];
    const parts = withoutQuery.split("/");

    const uploadIndex = parts.findIndex((p) => p === "upload");
    const publicIdParts = parts.slice(uploadIndex + 2);

    const filename = publicIdParts.join("/");
    return filename.replace(/\.[^/.]+$/, "");
  }

  /**
   * Delete image (SIGNED)
   */
  async removeByUrl(secureUrl: string) {
    const publicId = this.extractPublicIdFromUrl(secureUrl);
    return this.removeByPublicId(publicId);
  }

  async removeByPublicId(publicId: string) {
    const timestamp = Math.floor(Date.now() / 1000);

    const signature = this.generateSignature({
      public_id: publicId,
      timestamp,
    });

    const formData = new FormData();
    formData.append("public_id", publicId);
    formData.append("api_key", this.apiKey);
    formData.append("timestamp", timestamp.toString());
    formData.append("signature", signature);

    const response = await axios.post(
      `https://api.cloudinary.com/v1_1/${this.cloudName}/image/destroy`,
      formData,
      { headers: formData.getHeaders() },
    );

    return response.data;
  }
}
