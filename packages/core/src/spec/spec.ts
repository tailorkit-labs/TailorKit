import { z } from "zod";
import { componentRecord } from "./component";
import { viewRecord } from "./view";

const actionLeaf = z.object({
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
});

interface ActionRecord {
  [key: string]: z.infer<typeof actionLeaf> | ActionRecord;
}

const actionRecord: z.ZodType<ActionRecord> = z.lazy(() =>
  z.record(z.string(), z.union([actionLeaf, actionRecord])),
);

export const TailorKitSchemaSpec = z
  .object({
    version: z.literal(1),
    slots: z
      .record(
        z.string().min(1),
        z.object({ views: z.array(z.string().startsWith("/")), multiple: z.boolean().optional() }),
      )
      .default({}),
    actions: actionRecord.default({}),
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
