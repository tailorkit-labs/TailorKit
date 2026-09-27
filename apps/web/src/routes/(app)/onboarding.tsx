import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(app)/onboarding")({
  component: Onboarding,
  loader: async ({ context }) => {
    const orgs = await context.queryClient.query({
      ...context.orpc.user.getOrgs.queryOptions(),
      staleTime: "static",
    });

    if (orgs.length > 0) {
      throw redirect({ to: "/" });
    }

    throw redirect({ to: "/account/request-organization" });
  },
});

function Onboarding() {
  return null;
}
