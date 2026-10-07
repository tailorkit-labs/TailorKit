import { h } from "preact";
import { useState } from "preact/hooks";
import { defineView, defineClient } from "tailorkit/app";
import { Box, Button, Flex } from "./components";

const view = defineView({ slot: "panel", view: "/", component: Content });
function Content() {
  const [done, setDone] = useState(false);
  return h(
    Flex,
    { direction: "column", gap: "md" },
    h(Box, { textColor: "default" }, "Messages"),
    h(Button, { onClick: () => setDone(true) }, done ? "All caught up ✓" : "Mark as read"),
  );
}
export default defineClient({ slots: { panel: { "/": view } } });
