import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { defineChannel, GET } from "eve/channels";

// Eve 0.68 has no session-list HTTP route. This development-only route reads
// Eve's own local Workflow run records, without keeping a second session index.
export default defineChannel({
  routes: [
    GET("/tailorkit-agent/sessions", async (_request, { requestIp }) => {
      if (requestIp !== "127.0.0.1" && requestIp !== "::1" && requestIp !== "::ffff:127.0.0.1") {
        return Response.json(
          { error: "Session listing is available in local development only." },
          { status: 404 },
        );
      }

      const directory = join(process.cwd(), ".eve", ".workflow-data", "runs");
      let names: string[];
      try {
        names = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return Response.json({ sessions: [] });
        }
        throw error;
      }

      const records = await Promise.all(
        names
          .filter((name) => name.endsWith(".json"))
          .map(async (name) => {
            try {
              return JSON.parse(await readFile(join(directory, name), "utf8")) as {
                runId?: string;
                status?: string;
                updatedAt?: string;
                attributes?: Record<string, string>;
              };
            } catch {
              // A concurrently written or removed run can be skipped.
              return null;
            }
          }),
      );

      const eventsDirectory = join(process.cwd(), ".eve", ".workflow-data", "events");
      const eventNames = await readdir(eventsDirectory).catch(() => [] as string[]);
      const sessions = await Promise.all(
        records
          .filter(
            (record) =>
              record?.attributes?.["$eve.type"] === "session" && record.status === "running",
          )
          .map(async (record) => {
            const latestEvent = eventNames
              .filter((name) => name.startsWith(`${record!.runId}-evnt_`))
              .sort()
              .at(-1);
            let updatedAt = record!.updatedAt;
            if (latestEvent) {
              try {
                const event = JSON.parse(
                  await readFile(join(eventsDirectory, latestEvent), "utf8"),
                ) as { createdAt?: string };
                updatedAt = event.createdAt ?? updatedAt;
              } catch {
                // Keep the run timestamp if an event is still being written.
              }
            }
            return { id: record!.runId, updatedAt };
          }),
      );

      const ordered = sessions
        .filter(
          (record): record is { id: string; updatedAt: string } =>
            typeof record.id === "string" && typeof record.updatedAt === "string",
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      return Response.json({ sessions: ordered });
    }),
  ],
});
