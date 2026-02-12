import { createTransport } from "nodemailer";
import handlebars from "handlebars";
import fs from "fs/promises";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

export class MailService {
  private transporter: ReturnType<typeof createTransport>;

  constructor() {
    this.transporter = createTransport({
      service: "gmail",
      auth: {
        user: process.env.MAIL_USER, // Email
        pass: process.env.MAIL_PASS, // App Password
      },
    });
  }

  private renderTemplates = async (templateName: string, context: object) => {
    const __filename = fileURLToPath(import.meta.url); // add "type": "module" in package.json
    const __dirname = dirname(__filename);

    const templateDir = path.resolve(__dirname, "./templates");

    const templatePath = path.join(templateDir, `${templateName}.hbs`);

    const templateSource = await fs.readFile(templatePath, "utf-8");

    const compiledTemplate = handlebars.compile(templateSource);

    return compiledTemplate(context);
  };

  sendEmail = async (
    to: string,
    subject: string,
    templateName: string,
    context: object,
  ) => {
    try {
      const html = await this.renderTemplates(templateName, context);

      const result = await this.transporter.sendMail({
        from: process.env.MAIL_USER,
        to,
        subject,
        html,
      });

      return result;
    } catch (error) {
      throw error; // Re-throw so calling code knows it failed
    }
  };
}
