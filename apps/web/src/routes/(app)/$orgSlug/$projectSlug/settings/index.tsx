import { validateProjectSlug } from "@tailorkit/db/validate-project-slug";
import { LoadingButton as Button } from "#components/loading-button";
import {
  Card,
  CardDescription,
  CardFrame,
  CardFrameFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@tailorkit/ui/card";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@tailorkit/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@tailorkit/ui/field";
import { Input } from "@tailorkit/ui/input";
import { toastManager } from "@tailorkit/ui/toast";
import { useAppForm } from "@tailorkit/ui/form";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { PageLayout } from "#components/page-layout";
import { client, orpc } from "#lib/orpc";

export const Route = createFileRoute("/(app)/$orgSlug/$projectSlug/settings/")({
  component: ProjectSettingsPage,
});

function toSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
}

const projectSettingsSchema = z.object({
  name: z.string().min(1, "Name is required."),
  slug: z.string().superRefine((value, ctx) => {
    const result = validateProjectSlug(value);
    if (!result.valid) {
      ctx.addIssue({
        code: "custom",
        message: result.reason ?? "Enter a valid slug.",
      });
    }
  }),
});

function ProjectSettingsPage() {
  const { orgSlug, projectSlug } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const { data: project } = useSuspenseQuery(
    orpc.project.get.queryOptions({ input: { orgSlug, projectSlug } }),
  );

  const updateMutation = useMutation({
    mutationFn: (input: { name: string; slug: string }) =>
      client.project.update({
        name: input.name.trim(),
        orgSlug,
        projectSlug,
        slug: input.slug,
      }),
    onSuccess: async (updatedProject) => {
      await Promise.all([
        queryClient.invalidateQueries(orpc.project.list.queryOptions({ input: { orgSlug } })),
        queryClient.invalidateQueries(
          orpc.project.get.queryOptions({
            input: { orgSlug, projectSlug: updatedProject.slug },
          }),
        ),
      ]);

      toastManager.add({ title: "Project updated", type: "success" });

      if (updatedProject.slug !== projectSlug) {
        navigate({
          params: { orgSlug, projectSlug: updatedProject.slug },
          to: "/$orgSlug/$projectSlug/settings",
        });
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to update project";
      toastManager.add({ title: "Error", description: message, type: "error" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => client.project.delete({ orgSlug, projectSlug }),
    onSuccess: async () => {
      await queryClient.invalidateQueries(orpc.project.list.queryOptions({ input: { orgSlug } }));
      toastManager.add({ title: "Project deleted", type: "success" });
      navigate({ params: { orgSlug }, to: "/$orgSlug/~/projects" });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to delete project";
      toastManager.add({ title: "Error", description: message, type: "error" });
    },
  });

  const form = useAppForm({
    defaultValues: {
      name: project.name,
      slug: project.slug,
    },
    onSubmit: async ({ value }) => {
      try {
        await updateMutation.mutateAsync(value);
      } catch {
        // The mutation onError handler displays the toast.
      }
    },
    validators: { onSubmit: projectSettingsSchema },
  });

  const canDelete = deleteConfirmation === project.slug;

  return (
    <PageLayout description="Manage this project's identity and lifecycle." title="Settings">
      <CardFrame className="w-full">
        <Card>
          <CardHeader>
            <CardTitle>Project details</CardTitle>
            <CardDescription>
              Rename the project or change the URL slug used in this organisation.
            </CardDescription>
          </CardHeader>

          <form
            id="project-settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              form.handleSubmit();
            }}
          >
            <CardPanel className="flex max-w-lg flex-col gap-4">
              <form.AppField name="name">
                {(field) => <field.TextField label="Name" placeholder="Amazing project" />}
              </form.AppField>

              <form.AppField name="slug">
                {(field) => (
                  <field.TextField
                    description={`tailorkit.com/${orgSlug}/${field.state.value || "project-slug"}`}
                    label="Slug"
                    placeholder="amazing-project"
                    onChange={(event) => field.handleChange(toSlug(event.target.value))}
                  />
                )}
              </form.AppField>
            </CardPanel>
          </form>
        </Card>

        <CardFrameFooter className="flex justify-end relative">
          <form.AppForm>
            <form.SubmitButton form="project-settings-form" size="sm">
              Save changes
            </form.SubmitButton>
          </form.AppForm>
        </CardFrameFooter>
      </CardFrame>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>Delete project</CardTitle>
          <CardDescription>
            Permanently delete this project and revoke its project API keys.
          </CardDescription>
        </CardHeader>
        <CardPanel className="pt-0">
          <Button
            size="sm"
            type="button"
            variant="destructive"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2Icon />
            Delete project
          </Button>
        </CardPanel>
      </Card>

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            setDeleteConfirmation("");
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
            <DialogDescription>
              This permanently deletes {project.name} and revokes its project API keys. Type{" "}
              <span className="font-mono text-foreground">{project.slug}</span> to confirm.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Field>
              <FieldLabel>Project slug</FieldLabel>
              <Input
                autoComplete="off"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(toSlug(event.target.value))}
              />
              <FieldDescription>This action cannot be undone.</FieldDescription>
            </Field>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={!canDelete || deleteMutation.isPending}
              loading={deleteMutation.isPending}
              type="button"
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
            >
              Delete project
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </PageLayout>
  );
}
