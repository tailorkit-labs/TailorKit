import { CheckCircle2Icon, XCircleIcon } from "lucide-react";
import { Spinner } from "@tailorkit/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@tailorkit/ui/tooltip";
import type { OrgSlugAvailability } from "#lib/org-slug-availability";

interface OrgSlugAvailabilityIndicatorProps {
  availability: OrgSlugAvailability;
  submitError?: string | null;
}

export function OrgSlugAvailabilityIndicator({
  availability,
  submitError,
}: OrgSlugAvailabilityIndicatorProps) {
  const status = submitError ? "unavailable" : availability.status;
  const message = submitError ?? availability.message;

  if (status === "idle") {
    return null;
  }

  let tooltip = message ?? "This slug is not available.";
  let icon = <XCircleIcon className="size-4 text-destructive-foreground" />;

  if (status === "checking") {
    tooltip = "Checking slug availability...";
    icon = <Spinner className="size-4 text-muted-foreground" />;
  } else if (status === "available") {
    tooltip = "This slug is available.";
    icon = <CheckCircle2Icon className="size-4 text-green-600 dark:text-green-400" />;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex items-center" />}>{icon}</TooltipTrigger>
      <TooltipPopup>{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
