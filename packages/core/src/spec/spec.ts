import { z } from "zod";
import { componentRecord } from "./component";
import { viewRecord } from "./view";

const toolLeaf = z.strictObject({
  kind: z.enum(["client", "server"]),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
});

interface ToolRecord {
  [key: string]: z.infer<typeof toolLeaf> | ToolRecord;
}

const toolRecord: z.ZodType<ToolRecord> = z.lazy(() =>
  z.record(z.string(), z.union([toolLeaf, toolRecord])),
);

export const TailorKitSchemaSpec = z
  .strictObject({
    version: z.literal(1),
    slots: z
      .record(
        z.string().min(1),
        z.object({ views: z.array(z.string().startsWith("/")), multiple: z.boolean().optional() }),
      )
      .default({}),
    tools: toolRecord.default({}),
    scopes: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    components: componentRecord,
    views: viewRecord.default({}),
  })
  .superRefine((schema, ctx) => {
    for (const [name, slot] of Object.entries(schema.slots)) {
      slot.views.forEach((view, index) => {
        if (!Object.hasOwn(schema.views, view)) {
          ctx.addIssue({
            code: "custom",
            path: ["slots", name, "views", index],
            message: `Unknown view "${view}".`,
          });
        }
      });
    }
  });

export type TailorKitSchemaSpec = z.infer<typeof TailorKitSchemaSpec>;
