import type { ComponentProps } from "react";

import { cn } from "@tailorkit/ui";
import { Button } from "@tailorkit/ui/button";
import { Spinner } from "@tailorkit/ui/spinner";

type LoadingButtonProps = ComponentProps<typeof Button> & {
  loading?: boolean;
};

export function LoadingButton({
  children,
  className,
  disabled,
  loading = false,
  ...props
}: LoadingButtonProps) {
  return (
    <Button
      {...props}
      className={cn(loading && "data-loading:[&_svg:not([data-icon])]:hidden", className)}
      data-loading={loading ? "" : undefined}
      disabled={disabled || loading}
    >
      {loading && <Spinner aria-hidden="true" data-icon="inline-start" />}
      {children}
    </Button>
  );
}
