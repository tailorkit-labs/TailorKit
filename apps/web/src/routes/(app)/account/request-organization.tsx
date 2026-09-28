import { Link, createFileRoute } from "@tanstack/react-router";

import { AccountLayout } from "#components/account-layout";
import { CreateOrgDialog } from "#components/create-org-dialog";
import { PageLayout } from "#components/page-layout";
import { isOrgCreationManaged } from "#lib/org-creation";
import { Button, buttonVariants } from "@tailorkit/ui/button";
import { Card, CardFrame, CardHeader, CardPanel, CardTitle } from "@tailorkit/ui/card";

export const Route = createFileRoute("/(app)/account/request-organization")({
  component: RequestOrganizationPage,
});

function RequestOrganizationPage() {
  return (
    <AccountLayout>
      <PageLayout
        description={
          isOrgCreationManaged
            ? "Organisation creation is currently managed by the TailorKit team."
            : "Create a workspace for your projects and collaborators."
        }
        title="Create an organisation"
      >
        <CardFrame>
          <Card>
            <CardHeader>
              <CardTitle>{isOrgCreationManaged ? "Manual onboarding" : "New workspace"}</CardTitle>
            </CardHeader>
            <CardPanel className="flex flex-col gap-4">
              <p className="text-muted-foreground text-sm">
                {isOrgCreationManaged
                  ? "We're currently onboarding users manually. Contact us to create an organisation for your account."
                  : "Create an organisation to start building and managing TailorKit projects."}
              </p>
              <div className="flex flex-wrap gap-2">
                {isOrgCreationManaged ? (
                  <a
                    aria-label="Contact us"
                    className={buttonVariants({ size: "sm" })}
                    href="https://cal.com/alfiejones"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Contact us
                  </a>
                ) : (
                  <CreateOrgDialog>
                    <Button size="sm">Create organisation</Button>
                  </CreateOrgDialog>
                )}
                <Link
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                  to="/account/invites"
                >
                  View invites
                </Link>
              </div>
            </CardPanel>
          </Card>
        </CardFrame>
      </PageLayout>
    </AccountLayout>
  );
}
