import { CorsOptions } from "cors";

export const corsOptions: CorsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:8000",
    process.env.BASE_FRONTEND_URL!,
  ],
  credentials: true,
};
