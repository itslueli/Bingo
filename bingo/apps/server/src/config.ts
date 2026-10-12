import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3001),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  TOKEN_PEPPER: z.string().min(16),
  ROOM_TTL_HOURS: z.coerce.number().positive().default(24),
});

export const config = schema.parse(process.env);
