import { ClientProvider, defineClient } from "tailorkit/client";
import defaultView from "./slots/panel/index";

const client = defineClient({
  component: ClientProvider,
  slots: { panel: { "/": defaultView } },
});

export default client;
