import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@tailorkit/ui/button";
import {
  Card,
  CardDescription,
  CardFrame,
  CardFrameFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@tailorkit/ui/card";
import { Field, FieldLabel } from "@tailorkit/ui/field";
import { Input } from "@tailorkit/ui/input";

import { PageLayout } from "#components/page-layout";

export const Route = createFileRoute("/(app)/$orgSlug/~/(org)/settings/")({
  component: OrgSettingsGeneral,
});

function OrgSettingsGeneral() {
  const { orgSlug } = Route.useParams();
  const orgName = orgSlug.charAt(0).toUpperCase() + orgSlug.slice(1);

  return (
    <PageLayout description="Manage your organisation settings." title="General">
      <CardFrame>
        <Card>
          <CardHeader>
            <CardTitle>Organisation details</CardTitle>
            <CardDescription>Update your organisation name and URL slug.</CardDescription>
          </CardHeader>
          <CardPanel className="flex flex-col gap-4">
            <Field>
              <FieldLabel>Organisation name</FieldLabel>
              <Input defaultValue={orgName} />
            </Field>
            <Field>
              <FieldLabel>Slug</FieldLabel>
              <Input defaultValue={orgSlug} />
              <p className="text-muted-foreground text-xs">Your org URL: tailorkit.com/{orgSlug}</p>
            </Field>
          </CardPanel>
        </Card>
        <CardFrameFooter className="flex justify-end relative">
          <Button size="sm">Save changes</Button>
        </CardFrameFooter>
      </CardFrame>
    </PageLayout>
  );
}
