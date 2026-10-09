import { defineContract } from "@tailorkit/core/schema";
import { z } from "zod";

export function testContract(multiple = false) {
  return defineContract({
    views: { "/": z.looseObject({}).optional() },
    slots: { page: { views: ["/"], multiple } },
  });
}
