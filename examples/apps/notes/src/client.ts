import { defineClient } from "@tailorkit/app";
import defaultView from "./slots/panel/index";

const client = defineClient({
  slots: { panel: { "/": defaultView } },
});

export default client;
