import { createFileRoute } from "@tanstack/react-router";
import { DocsContent, loadDocsPage } from "./$";

export const Route = createFileRoute("/docs/")({
  component: Page,
  loader: () => loadDocsPage([]),
});

function Page() {
  return <DocsContent data={Route.useLoaderData()} />;
}
