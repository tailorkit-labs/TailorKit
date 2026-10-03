import { ClientProvider, defineClient } from "tailorkit/client";
import defaultView from "./views/default";

const client = defineClient({
  component: ClientProvider,
  slots: { panel: { "/": defaultView } },
});

export default client;
