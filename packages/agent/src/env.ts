import * as z from "zod";

export const env = z
  .object({
    DATABASE_URL: z.url(),
    VERCEL_ENV: z.string().optional(),
  })
  .parse(process.env);
