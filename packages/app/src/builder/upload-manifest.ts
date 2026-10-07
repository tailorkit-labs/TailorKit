import { z } from "zod";

export const tailorkitUploadManifestSchema = z.object({
  assets: z.object({
    client: z.literal("client/client.js"),
    server: z.literal("server/server.js").optional(),
    logos: z
      .object({
        dark: z
          .string()
          .regex(/^client\/logo-dark\.(?:png|svg|webp)$/u)
          .optional(),
        light: z
          .string()
          .regex(/^client\/logo-light\.(?:png|svg|webp)$/u)
          .optional(),
      })
      .optional(),
  }),
  views: z
    .array(
      z.object({
        slot: z.string().min(1).max(255),
        path: z.string().startsWith("/").max(1024),
        instances: z.literal(true).optional(),
        disabled: z.literal(true).optional(),
      }),
    )
    .max(1000)
    .optional(),
  version: z.literal(1),
});

export type TailorKitUploadManifest = z.output<typeof tailorkitUploadManifestSchema>;

export const createTailorKitUploadManifest = (
  logos?: TailorKitUploadManifest["assets"]["logos"],
  server = false,
  views?: TailorKitUploadManifest["views"],
): TailorKitUploadManifest =>
  tailorkitUploadManifestSchema.parse({
    assets: {
      client: "client/client.js",
      ...(server ? { server: "server/server.js" } : {}),
      ...(logos && Object.keys(logos).length > 0 ? { logos } : {}),
    },
    views,
    version: 1,
  });
