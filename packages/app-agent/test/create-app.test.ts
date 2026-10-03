import type { ToolContext } from "eve/tools";
import { describe, expect, it, vi } from "vite-plus/test";
import createApp from "../agent/tools/create-app";

vi.mock("eve/tools", () => ({ defineTool: (definition: unknown) => definition }));

const requestedHost = "https://host.example.com/api/tailorkit";

const reuseApp = ({
  host = requestedHost,
  configuredHost = host,
  missingFile,
  configError,
}: {
  host?: string;
  configuredHost?: string;
  missingFile?: string;
  configError?: string;
} = {}) => {
  const sandbox = {
    run: vi.fn(async ({ command }: { command: string }) => {
      if (command.startsWith("test ")) {
        return {
          exitCode: command === `test -f /workspace/app/${missingFile}` ? 1 : 0,
          stdout: "",
          stderr: "",
        };
      }
      return {
        exitCode: configError ? 1 : 0,
        stdout: configError ? "" : JSON.stringify({ host: configuredHost }),
        stderr: configError ?? "",
      };
    }),
    writeTextFile: vi.fn(),
  };
  const ctx = { getSandbox: async () => sandbox } as unknown as ToolContext;
  return { result: createApp.execute({ host }, ctx), sandbox };
};

describe("create-app reuse", () => {
  it("checks both scaffold files and returns the configured host without writes", async () => {
    const { result, sandbox } = reuseApp();
    await expect(result).resolves.toMatchObject({
      path: "/workspace/app",
      created: false,
      host: requestedHost,
    });
    expect(sandbox.run.mock.calls.map(([input]) => input.command).slice(0, 3)).toEqual([
      "test -e /workspace/app",
      "test -f /workspace/app/package.json",
      "test -f /workspace/app/tailorkit.config.ts",
    ]);
    expect(sandbox.writeTextFile).not.toHaveBeenCalled();
  });

  it.each(["package.json", "tailorkit.config.ts"])(
    "rejects a partial scaffold missing %s",
    async (missingFile) => {
      const { result, sandbox } = reuseApp({ missingFile });
      await expect(result).rejects.toThrow(`already exists without a ${missingFile}`);
      expect(sandbox.writeTextFile).not.toHaveBeenCalled();
      expect(sandbox.run.mock.calls.every(([input]) => input.command.startsWith("test "))).toBe(
        true,
      );
    },
  );

  it.each([
    "https://other.example.com/api/tailorkit",
    "http://host.example.com/api/tailorkit",
    "https://host.example.com/api/other",
  ])("rejects a conflicting configured host %s", async (configuredHost) => {
    const { result, sandbox } = reuseApp({ configuredHost });
    await expect(result).rejects.toThrow(
      `The existing app uses host ${configuredHost}, but ${requestedHost} was requested.`,
    );
    expect(sandbox.writeTextFile).not.toHaveBeenCalled();
  });

  it("compares hosts with the CLI's URL normalization", async () => {
    const configuredHost = "https://HOST.example.com:443/api/tailorkit///?old=true#section";
    await expect(reuseApp({ configuredHost }).result).resolves.toMatchObject({
      host: configuredHost,
      created: false,
    });
  });

  it("reports configuration loading failures without overwriting the app", async () => {
    const { result, sandbox } = reuseApp({ configError: "Invalid configuration" });
    await expect(result).rejects.toThrow(
      "Could not load /workspace/app/tailorkit.config.ts. Preserve its files: Invalid configuration",
    );
    expect(sandbox.writeTextFile).not.toHaveBeenCalled();
  });

  it("rejects a configured host outside HTTP(S)", async () => {
    await expect(reuseApp({ configuredHost: "file:///workspace/app" }).result).rejects.toThrow();
  });
});
