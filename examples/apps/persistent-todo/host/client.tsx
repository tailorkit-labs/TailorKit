// TypeScript uses Preact for the app, and React for this host entry.
// eslint-disable-next-line jsdoc/check-tag-names
/** @jsxImportSource react */
import { Button } from "@tailorkit/ui/components/button";
import { createRoot } from "react-dom/client";
import { createTailorKitClient, primitives, Root } from "@tailorkit/react";
import type { host } from "../vite.config";

const tailor = createTailorKitClient<typeof host>({
  baseUrl: "http://localhost:5011/api/tailorkit/",
  components: {
    ...primitives,
    Button: ({ props, children }) => <Button {...props}>{children}</Button>,
  },
});
const app = { id: "persistent-todo-demo", clientPath: "/app/client.js" };
const rootElement = document.querySelector("#root");
if (!rootElement) {
  throw new Error("Missing host root");
}
createRoot(rootElement).render(
  <Root client={tailor} apps={[app]}>
    <h1>Two clients, one installation</h1>
    <p>Changes in either sandbox appear in both. Restart Wrangler to check persistence.</p>
    <tailor.AppView app={app} slot="panel" view="/" context={{}} />
    <tailor.AppView app={app} slot="panel" view="/" context={{}} />
  </Root>,
);
