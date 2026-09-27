import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(auth)")({
  validateSearch: (search) => ({
    return_to: search.return_to as string | undefined,
  }),
  loader: async ({ context, location }) => {
    const session = await context.queryClient.query(context.orpc.user.getSession.queryOptions());

    if (session.session || session.user) {
      const returnTo = (location.search as { return_to?: string }).return_to;
      throw redirect({ to: returnTo ?? "/" });
    }
  },
});
