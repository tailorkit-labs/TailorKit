import { z } from "zod";

const clientConfigSchema = z.object({
  entry: z.string().default("./src/client.ts"),
});

const buildConfigSchema = z.object({
  outDir: z.string().default(".tailorkit"),
});

const logosConfigSchema = z.object({
  dark: z.string().min(1).optional(),
  light: z.string().min(1).optional(),
});

const tailorkitConfigSchema = z.object({
  appId: z.string().min(1).optional(),
  build: buildConfigSchema.optional(),
  client: clientConfigSchema.optional(),
  host: z.string().url(),
  logos: logosConfigSchema.optional(),
  server: z
    .object({
      entry: z.string().default("./src/server.ts"),
      references: z.string().default("./src/server.gen.ts"),
    })
    .optional(),
});

export type TailorKitConfig = z.input<typeof tailorkitConfigSchema>;
export type ResolvedTailorKitConfig = z.output<typeof tailorkitConfigSchema>;

export { tailorkitConfigSchema };

export const defineConfig = (config: TailorKitConfig): TailorKitConfig => config;
export const defineTailorKitConfig = defineConfig;
