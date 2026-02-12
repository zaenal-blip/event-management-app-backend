import { CorsOptions } from "cors";

export const corsOptions: CorsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:8000",
    "http://localhost:5174",
  ],
  credentials: true,
};
