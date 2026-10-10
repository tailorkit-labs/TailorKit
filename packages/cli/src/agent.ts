import { createTailorKitClient, type TailorKitRouterClient } from "@tailorkit/core/server";
import { autocomplete, cancel, isCancel, log, spinner, text } from "@clack/prompts";
import { getDeployToken, NotLoggedInError, resolveHostUrl, runWhoami } from "./auth";

interface AgentOptions {
  appId?: string;
  host?: string;
  onLoginRequired?: () => Promise<unknown>;
}

async function chooseApp(client: TailorKitRouterClient): Promise<string | undefined> {
  const loading = spinner();
  const apps: Awaited<ReturnType<TailorKitRouterClient["apps"]["list"]>>["items"] = [];
  loading.start("Finding apps");
  try {
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const result = await client.apps.list({ page, pageSize: 100 });
      apps.push(...result.items);
      hasMore = result.pagination.hasMore;
      page += 1;
    }
    loading.stop(apps.length ? "Found apps." : "No apps found.");
  } catch (error) {
    loading.stop("Unable to list apps.");
    throw error;
  }

  const selection = await autocomplete<string | null>({
    message: "Select an app or create a new one",
    placeholder: "Search by name or app ID",
    options: [
      ...apps.map((app) => ({ value: app.id, label: app.name, hint: app.publicId })),
      { value: null, label: "Create a new app" },
    ],
    filter: (search, option) =>
      option.value === null ||
      [option.label, option.hint, option.value].some((value) =>
        value?.toLowerCase().includes(search.toLowerCase()),
      ),
  });
  if (isCancel(selection)) {
    cancel("Agent cancelled.");
    return;
  }
  if (selection !== null) return selection;

  const name = await text({
    message: "App name",
    initialValue: "My app",
    placeholder: "My app",
    validate: (value) => (value?.trim() ? undefined : "Enter an app name."),
  });
  if (isCancel(name)) {
    cancel("Agent cancelled.");
    return;
  }
  loading.start("Creating app");
  try {
    const app = await client.apps.create({ name: name.trim(), description: null });
    loading.stop("Created app.");
    return app.id;
  } catch (error) {
    loading.stop("Unable to create app.");
    throw error;
  }
}

export async function runAgentCommand(options: AgentOptions) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("tailorkit agent requires an interactive terminal.");
  }
  if (!options.host?.trim()) {
    throw new Error("Missing TailorKit host URL. Use tailorkit agent --host <url>.");
  }
  let appId = options.appId;
  const hostUrl = await resolveHostUrl(options);
  try {
    await runWhoami(options);
  } catch (error) {
    if (!(error instanceof NotLoggedInError) || !options.onLoginRequired) throw error;
    await options.onLoginRequired();
    await runWhoami(options);
  }
  const auth = await getDeployToken(hostUrl);
  if (!auth) throw new NotLoggedInError(hostUrl);
  const client = createTailorKitClient({
    url: hostUrl,
    headers: { authorization: `Bearer ${auth.deployToken}` },
  });
  if (!appId) {
    appId = await chooseApp(client);
    if (!appId) return;
  }
  log.info(`App: ${appId}`);
  const { openAgentTui } = await import("./agent-tui");
  await openAgentTui({ client, hostUrl, appId });
}
