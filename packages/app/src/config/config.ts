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

const storageConfigSchema = z.object({
  entry: z.string().default("./src/server.ts"),
  migrations: z.string().default("./storage/migrations"),
  references: z.string().default("./src/storage.gen.ts"),
  workerName: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/u),
  issuer: z.url(),
  audience: z.string().min(1).default("tailorkit-storage"),
  publicKeys: z.string().default("./storage/public-keys.json"),
  origins: z.array(z.url()).min(1),
  /** Already provisioned runtime. The CLI checks compatibility before uploading client assets. */
  runtimeUrl: z.url().optional(),
  port: z.number().int().min(1024).max(65_535).default(8787),
});

const tailorkitConfigSchema = z.object({
  appId: z.string().min(1).optional(),
  build: buildConfigSchema.optional(),
  client: clientConfigSchema.optional(),
  host: z.string().url(),
  logos: logosConfigSchema.optional(),
  storage: storageConfigSchema.optional(),
});

export type TailorKitConfig = z.input<typeof tailorkitConfigSchema>;
export type ResolvedTailorKitConfig = z.output<typeof tailorkitConfigSchema>;

export { tailorkitConfigSchema };

export const defineConfig = (config: TailorKitConfig): TailorKitConfig => config;
export const defineTailorKitConfig = defineConfig;
