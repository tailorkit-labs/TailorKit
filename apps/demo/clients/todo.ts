import { h } from "preact";
import { useState } from "preact/hooks";
import { createView, defineClient } from "tailorkit/app";
import { Box, Button, Flex } from "./components";

const view = createView("/", { slot: "panel", component: Content });
function Content() {
  const [done, setDone] = useState(false);
  return h(
    Flex,
    { direction: "column", gap: "md" },
    h(Box, { textColor: "default" }, "Tasks"),
    h(Button, { onClick: () => setDone(true) }, done ? "Task added ✓" : "Add task"),
  );
}
export default defineClient({ slots: { panel: { "/": view } } });
