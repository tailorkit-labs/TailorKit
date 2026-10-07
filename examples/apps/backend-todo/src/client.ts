import { ClientProvider, defineClient } from "tailorkit/client";
import defaultView from "./views/default";

const client = defineClient({
  component: ClientProvider,
  slots: { page: { "/": defaultView } },
});

export default client;
