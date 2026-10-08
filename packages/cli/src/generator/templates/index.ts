import packageJsonTemplate from "./package.json.liquid";
import tsconfigTemplate from "./tsconfig.json.liquid";
import tailorkitConfigTemplate from "./tailorkit.config.ts.liquid";
import gitignoreTemplate from "./.gitignore.liquid";
import oxlintConfigTemplate from "./oxlint.config.ts.liquid";
import oxfmtConfigTemplate from "./oxfmt.config.ts.liquid";
import rootTemplate from "./src/root.tsx.liquid";
import defaultViewTemplate from "./src/slots/view.tsx.liquid";
import serverTemplate from "./src/server.ts.liquid";
import schemaTemplate from "./src/db/schema.ts.liquid";
import databaseTemplate from "./src/db/index.ts.liquid";
import relationsTemplate from "./src/db/relations.ts.liquid";
import greetingTemplate from "./src/functions/greeting.ts.liquid";
import logoDarkTemplate from "./logo-dark.svg.liquid";
import logoLightTemplate from "./logo-light.svg.liquid";

export {
  packageJsonTemplate,
  tsconfigTemplate,
  tailorkitConfigTemplate,
  gitignoreTemplate,
  oxlintConfigTemplate,
  oxfmtConfigTemplate,
  rootTemplate,
  defaultViewTemplate,
  serverTemplate,
  schemaTemplate,
  databaseTemplate,
  relationsTemplate,
  greetingTemplate,
  logoDarkTemplate,
  logoLightTemplate,
};
