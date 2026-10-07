import { createView } from "./app";

declare module "@tailorkit/app" {
  interface TailorKitSlots {
    packageTest: { views: "/package-test"; multiple: false };
  }
  interface TailorKitViews {
    "/package-test": { context: { customerId: string } };
  }
}

const view = createView({ slot: "packageTest", view: "/package-test", component: () => null });
const context = view.useContext();
context.customerId satisfies string;
// @ts-expect-error The umbrella export must preserve the registered context type.
context.customerId satisfies number;
