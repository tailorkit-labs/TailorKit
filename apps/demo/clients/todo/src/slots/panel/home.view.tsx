import { h } from "preact";
import { useState } from "preact/hooks";
import { defineView } from "tailorkit/app";
import { Box, Button, Flex } from "../../../../components";

const view = defineView({ slot: "panel", view: "/", component: Content });
function Content() {
  const [done, setDone] = useState(false);
  return h(
    Flex,
    { direction: "column", gap: "md" },
    h(Box, { textColor: "default" }, "Tasks"),
    h(Button, { onClick: () => setDone(true) }, done ? "Task added ✓" : "Add task"),
  );
}
export default view;
