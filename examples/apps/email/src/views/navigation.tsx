import { createView } from "@tailorkit/app";
import { Box } from "#tailorkit";

export default createView("/", { slot: "navbar", component: () => <Box>Email</Box> });
