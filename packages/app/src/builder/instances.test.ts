import { expect, it } from "vite-plus/test";
import { extractInstances } from "./instances";

const source = `
import { createView as cv } from "tailorkit/client";
import { z } from "zod";
import { serverHelper } from "./server-helper";
import { Widget } from "./widget";
const privateValue = "SERVER_ONLY_SECRET";
const shared = "Shared label";
function format(value) { return serverHelper(value) + privateValue + shared; }
const view = cv("/", {
  instances: {
    dataSchema: z.object({ id: z.string() }),
    resolve: async ({ queries, context }) => {
      const rows = await queries.reports.list({ user: context.user.id });
      return rows.map(row => ({ key: row.id, metadata: { title: format(row.id) }, data: { id: row.id } }));
    },
  },
  component: () => <Widget label={shared} />,
});
export default view;
`;

it("extracts resolver dependencies without executing or retaining the component", async () => {
  const result = await extractInstances("/app/src/page.tsx", source, "/app");
  expect(result).toBeDefined();
  expect(result!.server).toContain("SERVER_ONLY_SECRET");
  expect(result!.server).toContain("./server-helper");
  expect(result!.server).toContain("queries.reports.list");
  expect(result!.server).not.toContain("./widget");
  expect(result!.server).not.toContain("tailorkit/client");
  expect(result!.server).not.toContain("preact");
  expect(result!.browser).not.toContain("SERVER_ONLY_SECRET");
  expect(result!.browser).not.toContain("serverHelper");
  expect(result!.browser).not.toContain("queries.reports.list");
  expect(result!.browser).not.toContain('from "zod"');
  expect(result!.browser).toContain("./widget");
  expect(result!.browser).toContain("Shared label");
  expect(result!.server).toContain("Shared label");
  expect(result!.browser).toContain(result!.names[0]!);
});

it("keeps resolver references stable when component code or source positions change", async () => {
  const first = await extractInstances("/app/src/page.tsx", source, "/app");
  const second = await extractInstances(
    "/app/src/page.tsx",
    `\n// changed\n${source.replace("Shared label", "Other label")}`,
    "/app",
  );
  expect(second!.names).toEqual(first!.names);
});

it("handles shadowed variables, destructuring defaults and Unicode source offsets", async () => {
  const code = source
    .replace('"SERVER_ONLY_SECRET"', '"Private 🐈"')
    .replace(
      "const rows = await queries.reports.list",
      "function inner(privateValue) { return privateValue; }\nconst { id = format('x') } = context;\nvoid inner(id);\nconst rows = await queries.reports.list",
    );
  const result = await extractInstances("/app/src/page.tsx", code, "/app");
  expect(result!.server).toContain("Private 🐈");
  expect(result!.browser).not.toContain("Private 🐈");
});

it("rejects browser globals and captured view definitions in server resolvers", async () => {
  await expect(
    extractInstances(
      "/app/page.tsx",
      source.replace("serverHelper(value)", "document.title"),
      "/app",
    ),
  ).rejects.toThrow("browser global document");
  await expect(
    extractInstances(
      "/app/page.tsx",
      source.replace("serverHelper(value)", "view.useContext()"),
      "/app",
    ),
  ).rejects.toThrow("cannot capture a view definition");
});

it("rejects dynamic definitions rather than leaving a resolver in the browser", async () => {
  await expect(
    extractInstances(
      "/app/page.tsx",
      source.replace("instances: {", "instances: { ...extra,"),
      "/app",
    ),
  ).rejects.toThrow("cannot contain spreads");
  await expect(
    extractInstances("/app/page.tsx", source.replace('cv("/",', "cv(path,"), "/app"),
  ).rejects.toThrow("must be string literals");
  await expect(
    extractInstances(
      "/app/page.tsx",
      `function factory() { ${source.replace(/^import .*$/gm, "").replace("export default view;", "return view;")} }\nimport { createView as cv } from "tailorkit/client";`,
      "/app",
    ),
  ).rejects.toThrow("module scope");
});
