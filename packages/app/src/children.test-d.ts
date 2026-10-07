import { createRemoteComponent } from "./index";

const Container = createRemoteComponent<{ label?: string }, true>("Container", {
  children: true,
});
Container({ children: ["text", 0, null, false], label: "Contents" });
Container({});

const Leaf = createRemoteComponent<{ value?: string }>("Leaf");
Leaf({ value: "value" });
// @ts-expect-error leaf components do not accept children
Leaf({ children: "not allowed" });

const ExplicitLeaf = createRemoteComponent<object, false>("Leaf", { children: false });
// @ts-expect-error explicitly disabled children are rejected too
ExplicitLeaf({ children: ["not allowed"] });

declare module "./index" {
  interface TailorKitViews {
    "/": { context: { workspaceId: string } };
    "/users": { context: { workspaceId: string; userId: string } };
  }
  interface TailorKitSlots {
    panel: { views: "/" | "/users"; multiple: false };
    navbar: { views: "/" };
    page: { views: "/" | "/users"; multiple: true };
  }
}
