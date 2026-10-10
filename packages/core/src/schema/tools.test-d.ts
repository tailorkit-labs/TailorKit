import { expectTypeOf } from "vite-plus/test";
import { z } from "zod";
import { defineContract } from "./contract";
import { tool } from "./tools";
import type { ToolCallers, ToolImplementations } from "./tools";
import { createServer } from "../server/contract";
const contract = defineContract({
  tools: {
    ui: { open: tool.client().input(z.string()).output(z.boolean()) },
    data: {
      read: tool.server().input(z.string().transform(Number)).output(z.number()),
      sync: tool.server(),
      transformed: tool.server().output(z.string().transform(Number).pipe(z.number())),
    },
  },
});
declare const frontend: ToolCallers<typeof contract.tools>;
declare const backend: ToolCallers<typeof contract.tools, "server">;
expectTypeOf(frontend.ui.open("details")).toEqualTypeOf<Promise<boolean>>();
expectTypeOf(backend.data.read("1")).toEqualTypeOf<Promise<number>>();
expectTypeOf(backend.data.sync()).toEqualTypeOf<Promise<void>>();
expectTypeOf(backend.data.transformed()).toEqualTypeOf<Promise<number>>();
// @ts-expect-error client tools are unavailable in backend callers
backend.ui.open("details");
// @ts-expect-error caller input uses the schema's input type
backend.data.read(1);
const implementations: ToolImplementations<typeof contract.tools, "server"> = {
  data: { read: ({ input }) => input + 1, sync: () => {}, transformed: () => "42" },
};
createServer({ contract, tools: implementations });
// @ts-expect-error declared server tools need implementations
createServer({ contract });
// @ts-expect-error a server cannot implement client tools
createServer({ contract, tools: { ...implementations, ui: { open: () => true } } });
