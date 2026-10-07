import { createRemoteComponent } from "tailorkit/app";

declare module "tailorkit/app" {
  interface TailorKitViews {
    "/": { context: Record<string, never> };
  }
  interface TailorKitSlots {
    panel: { views: "/"; multiple: false };
  }
}

export const Flex = createRemoteComponent<
  { direction: string; gap: string; padding?: string },
  true
>("Flex", { children: true });
export const Box = createRemoteComponent<{ textColor?: string }, true>("Box", { children: true });
export const Button = createRemoteComponent<{ onClick: () => void }, true>("Button", {
  children: true,
  callbacks: { onClick: 0 },
});
