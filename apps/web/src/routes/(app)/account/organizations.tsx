import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2Icon, MailIcon, PlusIcon } from "lucide-react";

import { AccountLayout } from "#components/account-layout";
import { CreateOrgDialog } from "#components/create-org-dialog";
import { PageLayout } from "#components/page-layout";
import { isOrgCreationManaged } from "#lib/org-creation";
import { orpc } from "#lib/orpc";
import { Avatar, AvatarFallback } from "@tailorkit/ui/avatar";
import { Badge } from "@tailorkit/ui/badge";
import { Button, buttonVariants } from "@tailorkit/ui/button";
import { Card, CardFrame } from "@tailorkit/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tailorkit/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tailorkit/ui/table";

export const Route = createFileRoute("/(app)/account/organizations")({
  component: OrganizationsPage,
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.query(context.orpc.user.getOrgs.queryOptions()),
      context.queryClient.query(context.orpc.user.getPendingInvitations.queryOptions()),
    ]);
  },
});

function orgInitials(name: string) {
  return name
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

function OrganizationsPage() {
  const navigate = useNavigate();
  const { data: orgs } = useSuspenseQuery(orpc.user.getOrgs.queryOptions());
  const { data: invitations } = useSuspenseQuery(orpc.user.getPendingInvitations.queryOptions());
  const pendingInviteCount = invitations.length;

  return (
    <AccountLayout>
      <PageLayout
        actions={
          <>
            <Link
              className={buttonVariants({ size: "sm", variant: "outline" })}
              to="/account/invites"
            >
              <MailIcon aria-hidden="true" data-icon="inline-start" />
              Invites
              {pendingInviteCount > 0 && (
                <Badge size="sm" variant="info">
                  {pendingInviteCount}
                </Badge>
              )}
            </Link>
            {isOrgCreationManaged ? (
              <Link className={buttonVariants({ size: "sm" })} to="/account/request-organization">
                <PlusIcon aria-hidden="true" data-icon="inline-start" />
                New organisation
              </Link>
            ) : (
              <CreateOrgDialog>
                <Button size="sm" type="button">
                  <PlusIcon />
                  New organisation
                </Button>
              </CreateOrgDialog>
            )}
          </>
        }
        description="View your organisations and create a new workspace."
        title="Organisations"
      >
        {orgs.length === 0 ? (
          <CardFrame>
            <Card>
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Building2Icon />
                  </EmptyMedia>
                  <EmptyTitle>No organisations yet</EmptyTitle>
                  <EmptyDescription>
                    Create an organisation to start adding projects and teammates.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  {isOrgCreationManaged ? (
                    <Link
                      className={buttonVariants({ size: "sm" })}
                      to="/account/request-organization"
                    >
                      <PlusIcon aria-hidden="true" data-icon="inline-start" />
                      Create organisation
                    </Link>
                  ) : (
                    <CreateOrgDialog>
                      <Button size="sm" type="button">
                        <PlusIcon />
                        Create organisation
                      </Button>
                    </CreateOrgDialog>
                  )}
                </EmptyContent>
              </Empty>
            </Card>
          </CardFrame>
        ) : (
          <CardFrame className="w-full">
            <Table className="table-fixed" variant="card">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[48%]">Organisation</TableHead>
                  <TableHead className="w-[24%]">Slug</TableHead>
                  <TableHead className="w-[28%]">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map((org) => (
                  <TableRow
                    className={
                      org.slug
                        ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        : undefined
                    }
                    key={org.id}
                    onClick={() => {
                      if (org.slug) {
                        navigate({ params: { orgSlug: org.slug }, to: "/$orgSlug/~/projects" });
                      }
                    }}
                    onKeyDown={(event) => {
                      if (org.slug && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        navigate({ params: { orgSlug: org.slug }, to: "/$orgSlug/~/projects" });
                      }
                    }}
                    tabIndex={org.slug ? 0 : undefined}
                  >
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="size-8 rounded-md">
                          <AvatarFallback className="rounded-md bg-primary text-primary-foreground text-xs">
                            {orgInitials(org.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate font-medium text-sm">{org.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="truncate text-muted-foreground">
                      {org.slug ? `/${org.slug}` : "No slug set"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(org.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardFrame>
        )}
      </PageLayout>
    </AccountLayout>
  );
}
