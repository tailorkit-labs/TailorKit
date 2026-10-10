import { beforeEach, expect, it, vi } from "vite-plus/test";
import { deployTool } from "./deploy";

const mocks = vi.hoisted(() => ({ runCommand: vi.fn() }));
vi.mock("./utils", async (original) => ({
  ...(await original<typeof import("./utils")>()),
  toolNativeSandbox: async () => ({ runCommand: mocks.runCommand }),
}));
const context = {
  sandboxName: "sandbox-one",
  appId: "selected-app",
  deployToken: "private-token",
  platformUrl: "https://platform.test/api/platform",
};

beforeEach(() => {
  vi.resetAllMocks();
});

it("pins the authorized app and injects credentials only into the deploy process", async () => {
  mocks.runCommand.mockResolvedValue({
    exitCode: 0,
    stdout: async () => "Deployment: published-one",
    stderr: async () => "",
  });
  const result = await deployTool.execute!({}, { context, toolCallId: "deploy-one", messages: [] });
  expect(result).toEqual({ exitCode: 0, stdout: "Deployment: published-one", stderr: "" });
  const command = mocks.runCommand.mock.lastCall![0];
  expect(command).toMatchObject({
    cmd: "pnpm",
    args: [
      "--dir",
      "/tmp/tailorkit-cli",
      "exec",
      "tailorkit",
      "deploy",
      "--cwd",
      "/workspace/app",
      "--app-id",
      context.appId,
      "--no-interactive",
    ],
    env: {
      TAILORKIT_DEPLOY_TOKEN: context.deployToken,
      TAILORKIT_PLATFORM_URL: context.platformUrl,
    },
  });
  expect(command.args.join(" ")).not.toContain(context.deployToken);
});

it("returns failures for the agent to address and redacts echoed credentials", async () => {
  mocks.runCommand.mockResolvedValue({
    exitCode: 1,
    stdout: async () => context.deployToken,
    stderr: async () => `Rejected ${context.deployToken}`,
  });
  expect(
    await deployTool.execute!({}, { context, toolCallId: "deploy-one", messages: [] }),
  ).toEqual({
    exitCode: 1,
    stdout: "[redacted]",
    stderr: "Rejected [redacted]",
  });
});

it("redacts credentials from command transport failures", async () => {
  mocks.runCommand.mockRejectedValue(new Error(`Command failed: ${context.deployToken}`));
  expect(
    await deployTool.execute!({}, { context, toolCallId: "deploy-one", messages: [] }),
  ).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: "Command failed: [redacted]",
  });
});
