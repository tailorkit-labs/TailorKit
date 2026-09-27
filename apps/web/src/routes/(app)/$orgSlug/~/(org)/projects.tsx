import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";
import { FolderIcon, FolderPlusIcon } from "lucide-react";
import { Button } from "@tailorkit/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tailorkit/ui/empty";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  DialogPopup,
  DialogTrigger,
} from "@tailorkit/ui/dialog";
import { toastManager } from "@tailorkit/ui/toast";
import { useAppForm } from "@tailorkit/ui/form";
import { z } from "zod";
import { PageLayout } from "#components/page-layout";
import { OrgSlugAvailabilityIndicator } from "#components/org-slug-availability-indicator";
import { client, orpc } from "#lib/orpc";
import { setProjectApiKey } from "#utils/project-api-key-memory";

export const Route = createFileRoute("/(app)/$orgSlug/~/(org)/projects")({
  loader: ({ context, params }) =>
    context.queryClient.query(
      context.orpc.project.list.queryOptions({ input: { orgSlug: params.orgSlug } }),
    ),
  component: ProjectsPage,
});

function toSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
}

const projectSchema = z.object({
  name: z.string().min(1, "Name is required."),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters long.")
    .max(64, "Slug must be at most 64 characters long."),
});

type ProjectSlugAvailability =
  | { status: "idle"; message: string | null }
  | { status: "checking"; message: string | null }
  | { status: "available"; message: null }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

function getProjectSlugAvailability(
  slug: string,
  existingProjectSlugs: ReadonlySet<string>,
): ProjectSlugAvailability {
  if (!slug) {
    return { status: "idle", message: null };
  }

  if (slug.length < 3) {
    return { status: "unavailable", message: "Slug must be at least 3 characters long." };
  }

  if (slug.length > 64) {
    return { status: "unavailable", message: "Slug must be at most 64 characters long." };
  }

  if (existingProjectSlugs.has(slug)) {
    return { status: "unavailable", message: "This project slug is already taken." };
  }

  return { status: "available", message: null };
}

interface CreateProjectDialogProps {
  children: ReactNode;
  existingProjectSlugs: ReadonlySet<string>;
  orgSlug: string;
}

function CreateProjectDialog({
  children,
  existingProjectSlugs,
  orgSlug,
}: CreateProjectDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [slugSubmitError, setSlugSubmitError] = useState<string | null>(null);
  const slugTouched = useRef(false);

  const createMutation = useMutation({
    mutationFn: (input: { name: string; slug: string }) =>
      client.project.create({
        name: input.name.trim(),
        orgSlug,
        slug: input.slug,
      }),
    onSuccess: (project) => {
      queryClient.invalidateQueries(orpc.project.list.queryOptions({ input: { orgSlug } }));
      setProjectApiKey(orgSlug, project.slug, project.apiKey.key);
      form.reset();
      slugTouched.current = false;
      navigate({
        params: { orgSlug, projectSlug: project.slug },
        to: "/$orgSlug/$projectSlug/settings/api-keys",
      });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to create project";
      toastManager.add({ title: "Error", description: message, type: "error" });
    },
  });

  const form = useAppForm({
    defaultValues: { name: "", slug: "" },
    onSubmit: async ({ value }) => {
      const submitAvailability = getProjectSlugAvailability(value.slug, existingProjectSlugs);
      if (submitAvailability.status !== "available") {
        setSlugSubmitError(submitAvailability.message ?? "This project slug is not available.");
        toastManager.add({
          title: "Error",
          description: submitAvailability.message ?? "This project slug is not available.",
          type: "error",
        });
        return;
      }

      try {
        await createMutation.mutateAsync(value);
      } catch {
        // The mutation onError handler displays the toast.
      }
    },
    validators: { onSubmit: projectSchema },
  });

  const slug = useStore(form.store, (state) => state.values.slug);
  const slugAvailability = getProjectSlugAvailability(slug, existingProjectSlugs);

  function resetForm() {
    slugTouched.current = false;
    setSlugSubmitError(null);
    form.reset();
  }

  return (
    <Dialog onOpenChange={(open) => !open && resetForm()}>
      <DialogTrigger render={<span />}>{children}</DialogTrigger>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>Projects keep work scoped inside this organisation.</DialogDescription>
        </DialogHeader>

        <form
          className="contents"
          id="create-project-dialog-form"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            form.handleSubmit();
          }}
        >
          <DialogPanel className="flex flex-col gap-4">
            <form.AppField name="name">
              {(field) => (
                <field.TextField
                  autoComplete="off"
                  label="Name"
                  placeholder="Amazing project"
                  type="text"
                  onChange={(event) => {
                    if (!slugTouched.current) {
                      setSlugSubmitError(null);
                      form.setFieldValue("slug", toSlug(event.target.value));
                    }
                  }}
                />
              )}
            </form.AppField>

            <form.AppField name="slug">
              {(field) => (
                <field.TextField
                  autoComplete="off"
                  description={`tailorkit.com/${orgSlug}/${field.state.value || "project-slug"}`}
                  endAdornment={
                    <OrgSlugAvailabilityIndicator
                      availability={slugAvailability}
                      submitError={slugSubmitError}
                    />
                  }
                  label="Slug"
                  placeholder="amazing-project"
                  type="text"
                  onChange={(event) => {
                    slugTouched.current = true;
                    setSlugSubmitError(null);
                    field.handleChange(toSlug(event.target.value));
                  }}
                />
              )}
            </form.AppField>
          </DialogPanel>

          <DialogFooter>
            <DialogClose render={<Button size="sm" type="button" variant="ghost" />}>
              Cancel
            </DialogClose>
            <form.AppForm>
              <form.SubmitButton form="create-project-dialog-form" size="sm">
                Create project
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

function ProjectsPage() {
  const { orgSlug } = Route.useParams();
  const { data: projects } = useSuspenseQuery(
    orpc.project.list.queryOptions({ input: { orgSlug } }),
  );
  const existingProjectSlugs = new Set(projects.map((project) => project.slug));

  return (
    <PageLayout
      actions={
        <CreateProjectDialog existingProjectSlugs={existingProjectSlugs} orgSlug={orgSlug}>
          <Button size="sm">
            <FolderPlusIcon />
            New project
          </Button>
        </CreateProjectDialog>
      }
      description="All projects in this organisation."
      title="Projects"
    >
      {projects.length === 0 ? (
        <Empty className="mx-auto w-full rounded-lg border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderPlusIcon />
            </EmptyMedia>
            <EmptyTitle>No projects yet</EmptyTitle>
            <EmptyDescription>
              Create a project to start building inside this organisation.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <CreateProjectDialog existingProjectSlugs={existingProjectSlugs} orgSlug={orgSlug}>
              <Button size="sm">
                <FolderPlusIcon />
                Create project
              </Button>
            </CreateProjectDialog>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              className="group flex flex-col gap-2 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
              params={{ orgSlug, projectSlug: project.slug }}
              to="/$orgSlug/$projectSlug"
            >
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-md bg-muted">
                  <FolderIcon className="size-3.5 text-muted-foreground" />
                </span>
                <span className="font-medium text-sm">{project.name}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
