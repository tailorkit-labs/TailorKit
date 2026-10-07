import { defineView } from "@tailorkit/app";
import { Box } from "#tailorkit";

export default defineView({ slot: "navbar", view: "/", component: () => <Box>Email</Box> });
