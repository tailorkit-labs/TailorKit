import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { CopyIcon, EyeIcon, EyeOffIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { DateAgo } from "@tailorkit/ui/date";
import { Button } from "@tailorkit/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
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
import { Field, FieldLabel } from "@tailorkit/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@tailorkit/ui/input-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@tailorkit/ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@tailorkit/ui/tooltip";
import { toastManager } from "@tailorkit/ui/toast";
import { PageLayout } from "#components/page-layout";
import { client, orpc } from "#lib/orpc";
import { getProjectApiKey, setProjectApiKey } from "#utils/project-api-key-memory";

export const Route = createFileRoute("/(app)/$orgSlug/$projectSlug/settings/api-keys")({
  loader: ({ context, params }) =>
    context.queryClient.query(
      context.orpc.project.apiKeys.queryOptions({
        input: { orgSlug: params.orgSlug, projectSlug: params.projectSlug },
      }),
    ),
  component: ProjectApiKeysPage,
});

const gracePeriodOptions = [
  { label: "Immediately", value: "0" },
  { label: "After 15 minutes", value: "900" },
  { label: "After 1 hour", value: "3600" },
  { label: "After 1 day", value: "86400" },
] as const;

function keyLabel(key: { id: string; prefix?: string | null; start?: string | null }) {
  return `${key.prefix ?? key.start ?? key.id}${"*".repeat(8)}`;
}

function LastUsedLabel({ lastRequest }: { lastRequest?: Date | string | null }) {
  return (
    <span className="shrink-0 text-muted-foreground text-xs">
      Last used {lastRequest ? <DateAgo className="inline" date={lastRequest} /> : "never"}
    </span>
  );
}

function ProjectApiKeysPage() {
  const { orgSlug, projectSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const [gracePeriodSeconds, setGracePeriodSeconds] = useState("3600");
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
  const [newApiKeyDialogOpen, setNewApiKeyDialogOpen] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [showNewApiKey, setShowNewApiKey] = useState(false);
  const [showStoredApiKey, setShowStoredApiKey] = useState(false);
  const [storedApiKey, setStoredApiKey] = useState(() => getProjectApiKey(orgSlug, projectSlug));
  const { data: apiKeys } = useSuspenseQuery(
    orpc.project.apiKeys.queryOptions({ input: { orgSlug, projectSlug } }),
  );

  const rotateMutation = useMutation({
    mutationFn: () =>
      client.project.rotateApiKey({
        gracePeriodSeconds: Number(gracePeriodSeconds),
        orgSlug,
        projectSlug,
      }),
    onSuccess: async (result) => {
      setNewApiKey(result.apiKey.key);
      setShowNewApiKey(false);
      setStoredApiKey(result.apiKey.key);
      setShowStoredApiKey(false);
      setRotateDialogOpen(false);
      setNewApiKeyDialogOpen(true);
      setProjectApiKey(orgSlug, projectSlug, result.apiKey.key);
      await queryClient.invalidateQueries(
        orpc.project.apiKeys.queryOptions({ input: { orgSlug, projectSlug } }),
      );
      toastManager.add({ title: "API key rotated", type: "success" });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to rotate API key";
      toastManager.add({ title: "Error", description: message, type: "error" });
    },
  });

  async function copyApiKey(value: string) {
    await navigator.clipboard.writeText(value);
    toastManager.add({ title: "API key copied", type: "success" });
  }

  const activeKey = apiKeys.active[0] ?? null;
  const expiringKeys = apiKeys.rotating;
  const projectKeyPanel = (() => {
    if (!activeKey) {
      return <p className="text-muted-foreground text-sm">No API key yet.</p>;
    }

    if (!storedApiKey) {
      return (
        <div className="min-w-0 rounded-lg border bg-muted px-3 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <p className="min-w-0 flex-1 truncate font-mono text-sm">{keyLabel(activeKey)}</p>
            <LastUsedLabel lastRequest={activeKey.lastRequest} />
          </div>
          <div className="min-w-0">
            <p className="mt-0.5 text-muted-foreground text-xs">
              The full key is only shown once. Rotate it if you need a new one.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-w-0 items-center gap-3">
        <InputGroup className="min-w-0 flex-1 bg-muted">
          <InputGroupInput
            aria-label="Project API key"
            className="font-mono"
            readOnly
            type={showStoredApiKey ? "text" : "password"}
            value={storedApiKey}
          />
          <InputGroupAddon align="inline-end" className="gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={showStoredApiKey ? "Hide API key" : "Show API key"}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                    onClick={() => setShowStoredApiKey((value) => !value)}
                  />
                }
              >
                {showStoredApiKey ? <EyeOffIcon /> : <EyeIcon />}
              </TooltipTrigger>
              <TooltipPopup>{showStoredApiKey ? "Hide API key" : "Show API key"}</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Copy API key"
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                    onClick={() => copyApiKey(storedApiKey)}
                  />
                }
              >
                <CopyIcon />
              </TooltipTrigger>
              <TooltipPopup>Copy API key</TooltipPopup>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
      </div>
    );
  })();

  return (
    <PageLayout
      description="Manage the secret key used to authenticate your backend with this project."
      title="API keys"
    >
      {/* New key reveal dialog */}
      <Dialog open={newApiKeyDialogOpen} onOpenChange={setNewApiKeyDialogOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>
              This key is only shown once. Copy it now — it won't be visible again after you close
              this dialog.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <InputGroup>
              <InputGroupInput
                aria-label="New API key"
                className="font-mono"
                readOnly
                type={showNewApiKey ? "text" : "password"}
                value={newApiKey ?? ""}
              />
              <InputGroupAddon align="inline-end" className="gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={showNewApiKey ? "Hide API key" : "Show API key"}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                        onClick={() => setShowNewApiKey((value) => !value)}
                      />
                    }
                  >
                    {showNewApiKey ? <EyeOffIcon /> : <EyeIcon />}
                  </TooltipTrigger>
                  <TooltipPopup>{showNewApiKey ? "Hide API key" : "Show API key"}</TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label="Copy API key"
                        disabled={!newApiKey}
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          if (newApiKey) {
                            copyApiKey(newApiKey);
                          }
                        }}
                      />
                    }
                  >
                    <CopyIcon />
                  </TooltipTrigger>
                  <TooltipPopup>Copy API key</TooltipPopup>
                </Tooltip>
              </InputGroupAddon>
            </InputGroup>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Done</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {/* Rotate key dialog */}
      <Dialog open={rotateDialogOpen} onOpenChange={setRotateDialogOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Rotate API key</DialogTitle>
            <DialogDescription>
              Choose when the current key should stop working after the new key is created.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Field>
              <FieldLabel>Current key stops working</FieldLabel>
              <Select
                items={gracePeriodOptions}
                value={gracePeriodSeconds}
                onValueChange={(value) => {
                  if (typeof value === "string") {
                    setGracePeriodSeconds(value);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {gracePeriodOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </Field>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={rotateMutation.isPending}
              type="button"
              onClick={() => rotateMutation.mutate()}
            >
              <RefreshCwIcon />
              {rotateMutation.isPending ? "Rotating…" : "Rotate key"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Project key</CardTitle>
          <CardDescription>Used to by your platform to integrate with Tailorkit.</CardDescription>
          <CardAction>
            <Button
              disabled={rotateMutation.isPending}
              size="sm"
              type="button"
              variant="destructive-outline"
              onClick={() => setRotateDialogOpen(true)}
            >
              <RefreshCwIcon />
              Rotate
            </Button>
          </CardAction>
        </CardHeader>

        <CardPanel className="pt-0">{projectKeyPanel}</CardPanel>
      </Card>

      {expiringKeys.length > 0 ? (
        <div>
          <p className="mb-3 font-medium text-sm">Expiring keys</p>
          <div className="space-y-2">
            {expiringKeys.map((key) => (
              <Card key={key.id}>
                <CardPanel>
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm">{keyLabel(key)}</p>
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      Expires{" "}
                      {key.expiresAt ? (
                        <DateAgo className="inline" date={key.expiresAt} />
                      ) : (
                        "never"
                      )}
                    </p>
                  </div>
                </CardPanel>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </PageLayout>
  );
}
