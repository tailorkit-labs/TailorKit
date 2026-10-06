import { APIError, Drive, Sandbox } from "@vercel/sandbox";
import { FatalError } from "workflow";

export const sandboxIdleTimeoutMs = 15 * 60_000;

export async function prepareSandbox(driveName: string, sandboxName: string) {
  "use step";
  try {
    const drive = await Drive.getOrCreate({ name: driveName });
    if (drive.currentSandboxName && drive.currentSandboxName !== sandboxName) {
      throw new FatalError(
        "This app is already being edited. Retry after the active run finishes.",
      );
    }
    // The mount is the atomic lock, including when two detached-Drive checks race.
    await Sandbox.getOrCreate({
      name: sandboxName,
      image: "vercel/sandbox/universal",
      region: drive.region,
      persistent: false,
      timeout: sandboxIdleTimeoutMs,
      mounts: { "/workspace": drive },
    });
  } catch (error) {
    // Mount conflicts end the workflow instead of turning into waiting retries.
    if (error instanceof APIError)
      throw new FatalError(`Cannot open app workspace: ${error.message}`);
    throw error;
  }
}

/** Retrieve the existing VM and top up its remaining lifetime to 15 minutes. */
export async function getSandbox(name: string) {
  try {
    const sandbox = await Sandbox.get({ name });
    const expiresAt = sandbox.expiresAt?.getTime();
    if (sandbox.status !== "running" || !expiresAt || expiresAt <= Date.now()) {
      throw new FatalError("App agent sandbox is no longer running.");
    }
    const extension = Date.now() + sandboxIdleTimeoutMs - expiresAt;
    if (extension > 0) {
      // Session methods cannot auto-resume a stopped VM and remount its Drive.
      await sandbox.currentSession().extendTimeout(extension);
    }
    return sandbox;
  } catch (error) {
    if (error instanceof APIError)
      throw new FatalError(`Cannot access app sandbox: ${error.message}`);
    throw error;
  }
}

export async function renewSandbox(name: string) {
  "use step";
  await getSandbox(name);
}

/** Called only in the workflow's final cleanup. Its Drive survives. */
export async function deleteSandbox(name: string) {
  "use step";
  try {
    const sandbox = await Sandbox.get({ name });
    await sandbox.delete({ deleteOrphanSnapshots: true });
  } catch (error) {
    if (error instanceof APIError && error.response.status === 404) return;
    console.warn("App agent sandbox cleanup failed; idle timeout will release the Drive", error);
  }
}
