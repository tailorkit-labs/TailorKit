import { z } from "zod";

const buildConfigSchema = z.object({
  outDir: z.string().default(".tailorkit"),
});

const logosConfigSchema = z.object({
  dark: z.string().min(1).optional(),
  light: z.string().min(1).optional(),
});

const tailorkitConfigSchema = z.strictObject({
  appId: z.string().min(1).optional(),
  build: buildConfigSchema.optional(),
  client: z.strictObject({ entry: z.string().min(1).default("src/client.ts") }).optional(),
  host: z.string().url(),
  logos: logosConfigSchema.optional(),
  server: z
    .strictObject({
      entry: z.string().min(1).default("src/server.ts"),
      migrations: z.string().min(1).optional(),
    })
    .optional(),
});

export type TailorKitConfig = z.input<typeof tailorkitConfigSchema>;
export type ResolvedTailorKitConfig = z.output<typeof tailorkitConfigSchema>;

export { tailorkitConfigSchema };

export const defineConfig = (config: TailorKitConfig): TailorKitConfig => config;
export const defineTailorKitConfig = defineConfig;
