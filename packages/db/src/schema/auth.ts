export * from "./auth.generated";

import { organization } from "./auth.generated";

export type Organization = typeof organization.$inferSelect;
