import { z } from "zod";

export const tailorkitUploadManifestSchema = z.object({
  assets: z.object({
    client: z.literal("client.js"),
    server: z.literal("server.js").optional(),
    logos: z
      .object({
        dark: z
          .string()
          .regex(/^logo-dark\.(?:png|svg|webp)$/u)
          .optional(),
        light: z
          .string()
          .regex(/^logo-light\.(?:png|svg|webp)$/u)
          .optional(),
      })
      .optional(),
  }),
  version: z.literal(1),
});

export type TailorKitUploadManifest = z.output<typeof tailorkitUploadManifestSchema>;

export const createTailorKitUploadManifest = (
  logos?: TailorKitUploadManifest["assets"]["logos"],
  server = false,
): TailorKitUploadManifest =>
  tailorkitUploadManifestSchema.parse({
    assets: {
      client: "client.js",
      ...(server ? { server: "server.js" } : {}),
      ...(logos && Object.keys(logos).length > 0 ? { logos } : {}),
    },
    version: 1,
  });
