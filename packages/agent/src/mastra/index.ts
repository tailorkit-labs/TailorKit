import { Mastra } from "@mastra/core/mastra";
import { AgentController } from "@mastra/core/agent-controller";
import { createDurableAgent } from "@mastra/core/agent/durable";
import { PostgresStore } from "@mastra/pg";
import {
  MastraStorageExporter,
  MastraPlatformExporter,
  Observability,
  SensitiveDataFilter,
} from "@mastra/observability";
import { env } from "#env";
import { agent, workspace } from "./agents/agent";

const durableAgent = createDurableAgent({ agent });
const storage = env.DATABASE_URL
  ? new PostgresStore({
      id: "mastra-storage",
      connectionString: env.DATABASE_URL,
      max: 5,
    })
  : undefined;

const codingController = new AgentController({
  id: "tailorkit-coding-controller",
  agent,
  workspace,
  ...(storage ? { storage } : {}),
  modes: [{ id: "build", name: "Build", metadata: { default: true } }],
});

export const mastra = new Mastra({
  agents: { agent: durableAgent },
  agentControllers: { codingController },
  recovery: { durableAgents: "auto" },
  ...(storage ? { storage } : {}),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "mastra",
        exporters: [
          ...(storage ? [new MastraStorageExporter()] : []),
          new MastraPlatformExporter(),
        ],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
