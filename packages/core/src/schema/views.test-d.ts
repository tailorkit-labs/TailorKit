import { expectTypeOf } from "vite-plus/test";
import type { z } from "zod";
import type { ViewDefinition, ViewDefinitions } from "./views";

type CustomerView = ViewDefinition<z.ZodObject<{ customerId: z.ZodString }>>;

expectTypeOf<CustomerView>().toEqualTypeOf<z.ZodObject<{ customerId: z.ZodString }>>();

expectTypeOf<{
  "/customers/:customerId": CustomerView;
}>().toMatchTypeOf<ViewDefinitions>();
