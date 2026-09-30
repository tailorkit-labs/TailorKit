import { defineClient } from "tailorkit/app";
import defaultView from "./views/default";

const client = defineClient({
  slots: { panel: { "/": defaultView } },
});

export default client;
