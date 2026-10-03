import { Link } from "@tanstack/react-router";
import { Button } from "@tailorkit/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tailorkit/ui/empty";
import { HomeIcon } from "lucide-react";

export function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-16">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon" className="tracking-tight text-sm text-primary">
            404
          </EmptyMedia>
          <EmptyTitle>Page not found</EmptyTitle>
          <EmptyDescription>You might not have permissions to view this page.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex gap-2">
            <Button render={<Link to="/" />}>
              <HomeIcon className="mr-2" />
              Home
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </main>
  );
}
