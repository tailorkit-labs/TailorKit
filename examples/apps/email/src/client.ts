import { defineClient } from "@tailorkit/app";
import navigation from "./slots/navbar/index";
import defaultView from "./slots/panel/index";

const client = defineClient({
  slots: {
    panel: { "/": defaultView },
    navbar: { "/": navigation },
  },
});

export default client;
