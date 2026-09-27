import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@tailorkit/ui/input";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@tailorkit/ui/tabs";
import { toastManager } from "@tailorkit/ui/toast";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { InviteMembersDialog } from "#components/members/invite-members-dialog";
import { InvitationsTable } from "#components/members/invitations-table";
import type { InvitationRow } from "#components/members/invitations-table";
import { MembersTable } from "#components/members/members-table";
import type { MemberRow } from "#components/members/members-table";
import { PageLayout } from "#components/page-layout";
import { client, orpc } from "#lib/orpc";

export const Route = createFileRoute("/(app)/$orgSlug/~/(org)/settings/members")({
  component: OrgSettingsMembers,
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.query({
        ...context.orpc.org.getMembers.queryOptions({ input: { orgSlug: params.orgSlug } }),
      }),
      context.queryClient
        .query({
          ...context.orpc.org.getOrgInvitations.queryOptions({
            input: { orgSlug: params.orgSlug },
          }),
        })
        .catch(() => null),
    ]);
  },
});

function OrgSettingsMembers() {
  const { orgSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const { data: session } = useQuery(orpc.user.getSession.queryOptions());
  const { data: members } = useSuspenseQuery(
    orpc.org.getMembers.queryOptions({ input: { orgSlug } }),
  );
  const { data: invitations } = useSuspenseQuery(
    orpc.org.getOrgInvitations.queryOptions({ input: { orgSlug } }),
  );
  const [search, setSearch] = useState("");

  const currentMember = members.find((member) => member.user.id === session?.user?.id);
  const canManage = currentMember?.role === "owner" || currentMember?.role === "admin";

  const removeMutation = useMutation({
    mutationFn: (memberId: string) => client.org.removeMember({ orgSlug, memberId }),
    onSuccess: () => {
      queryClient.invalidateQueries(orpc.org.getMembers.queryOptions({ input: { orgSlug } }));
      toastManager.add({ title: "Member removed", type: "success" });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to remove member";
      toastManager.add({ title: "Error", description: message, type: "error" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      client.org.inviteMember({ orgSlug, email, role: role as "member" | "admin" }),
    onSuccess: () => {
      toastManager.add({ title: "Invitation resent", type: "success" });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to resend invitation";
      toastManager.add({ title: "Error", description: message, type: "error" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) => client.org.revokeInvitation({ orgSlug, invitationId }),
    onSuccess: () => {
      queryClient.invalidateQueries(
        orpc.org.getOrgInvitations.queryOptions({ input: { orgSlug } }),
      );
      toastManager.add({ title: "Invitation revoked", type: "success" });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to revoke invitation";
      toastManager.add({ title: "Error", description: message, type: "error" });
    },
  });

  const memberRows = useMemo<MemberRow[]>(
    () =>
      members.map((member) => ({
        id: member.id,
        name: member.user.name,
        email: member.user.email,
        role: member.role,
        createdAt: member.createdAt,
        userId: member.user.id,
        isCurrentUser: member.user.id === session?.user?.id,
        isOwner: member.role === "owner",
      })),
    [members, session?.user?.id],
  );

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries(orpc.org.getMembers.queryOptions({ input: { orgSlug } }));
    queryClient.invalidateQueries(orpc.org.getOrgInvitations.queryOptions({ input: { orgSlug } }));
  }, [orgSlug, queryClient]);

  const handleRemoveMember = useCallback(
    (id: string) => {
      removeMutation.mutate(id);
    },
    [removeMutation],
  );

  const handleResendInvitation = useCallback(
    (invitation: InvitationRow) => {
      resendMutation.mutate({ email: invitation.email, role: invitation.role ?? "member" });
    },
    [resendMutation],
  );

  const handleRevokeInvitation = useCallback(
    (id: string) => {
      revokeMutation.mutate(id);
    },
    [revokeMutation],
  );

  return (
    <PageLayout
      actions={
        canManage ? <InviteMembersDialog orgSlug={orgSlug} onSuccess={invalidateAll} /> : null
      }
      description="Manage who has access to this organisation."
      title="Members"
    >
      <Tabs defaultValue="members">
        <div className="flex items-center justify-between gap-4">
          <TabsList>
            <TabsTab value="members">Members</TabsTab>
            <TabsTab value="invitations">
              Pending invitations
              {invitations.length > 0 && (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
                  {invitations.length}
                </span>
              )}
            </TabsTab>
          </TabsList>

          <div className="relative w-64 max-w-full">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="bg-popover [&_[data-slot=input]]:pl-8"
              placeholder="Search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <TabsPanel value="members" className="mt-4">
          <MembersTable
            members={memberRows}
            canManage={canManage}
            onRemove={handleRemoveMember}
            removePending={removeMutation.isPending}
            search={search}
          />
        </TabsPanel>

        <TabsPanel value="invitations" className="mt-4">
          <InvitationsTable
            invitations={invitations}
            canManage={canManage}
            onResend={handleResendInvitation}
            onRevoke={handleRevokeInvitation}
            resendPending={resendMutation.isPending}
            revokePending={revokeMutation.isPending}
          />
        </TabsPanel>
      </Tabs>
    </PageLayout>
  );
}
