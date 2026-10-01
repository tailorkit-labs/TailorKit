import { reference } from "@tailorkit/apps-server/client";
import type { References } from "@tailorkit/apps-server/client";
import type app from "./server";
export const api = new Proxy(
  {},
  {
    get(_target, name) {
      return reference(String(name), "query");
    },
  },
) as References<typeof app.functions>;
