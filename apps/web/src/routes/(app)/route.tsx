import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(app)")({
  loader: async ({ context, location }) => {
    const session = await context.queryClient.query({
      ...context.orpc.user.getSession.queryOptions(),
    });

    if (!session.session) {
      throw redirect({
        search: { email: undefined, return_to: location.pathname },
        to: "/login",
      });
    }

    void context.queryClient.query({
      ...context.orpc.user.getOrgs.queryOptions(),
    });
  },
});
