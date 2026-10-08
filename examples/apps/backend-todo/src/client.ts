import { ClientProvider, defineClient } from "tailorkit/client";
import defaultView from "./slots/page/index";

const client = defineClient({
  component: ClientProvider,
  slots: { page: { "/": defaultView } },
});

export default client;
