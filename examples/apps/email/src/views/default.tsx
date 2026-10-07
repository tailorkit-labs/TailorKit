import { Box } from "#tailorkit";
import { defineView } from "@tailorkit/app";

const view = defineView({ slot: "panel", view: "/", component: ViewComponent });

function ViewComponent() {
  return <Box>Hello World</Box>;
}

export default view;
