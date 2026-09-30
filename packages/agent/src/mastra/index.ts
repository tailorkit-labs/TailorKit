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
import { env } from "../env";
import { agent, workspace } from "./agents/agent";

const durableAgent = createDurableAgent({ agent });
const storage = new PostgresStore({
  id: "mastra-storage",
  connectionString: env.DATABASE_URL,
  schemaName: "mastra",
  max: 5,
});

const codingController = new AgentController({
  id: "tailorkit-coding-controller",
  agent,
  workspace,
  storage,
  initialState: { yolo: true },
  modes: [{ id: "build", name: "Build", metadata: { default: true } }],
});

export const mastra = new Mastra({
  agents: { agent: durableAgent },
  agentControllers: { codingController },
  recovery: { durableAgents: "auto" },
  storage,
  observability: new Observability({
    configs: {
      default: {
        serviceName: "mastra",
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
