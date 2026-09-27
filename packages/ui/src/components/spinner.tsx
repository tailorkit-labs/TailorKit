import { Loader2Icon } from "lucide-react";
import type React from "react";
import { cn } from "#ui";

export function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof Loader2Icon>): React.ReactElement {
  return <Loader2Icon aria-label="Loading" className={cn("animate-spin", className)} {...props} />;
}
