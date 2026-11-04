import dotenv from 'dotenv';
import { z } from 'zod';
dotenv.config({ path: '../.env', quiet: true });
dotenv.config({ quiet: true });
export const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32),
    PORT: z.coerce.number().default(3001),
    CLIENT_URL: z.union([z.literal('*'), z.string().url()]).default('http://localhost:5174'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PUPPETEER_EXECUTABLE_PATH: z.string().optional(),
    PUPPETEER_NO_SANDBOX: z.string().default('false'),
  })
  .parse(process.env);
