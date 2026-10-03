import { Link, createFileRoute, notFound, useLocation } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import browserCollections from "#collections/browser";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import { FullSearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/notebook/page";
import { Suspense } from "react";

import { useMDXComponents } from "#components/mdx";
import { SiteNavbar } from "#components/site-navbar";
import { baseOptions } from "#lib/layout.shared";
import { gitConfig } from "#lib/shared";
import { getPageMarkdownUrl, source } from "#lib/source";

export const Route = createFileRoute("/docs/$")({
  component: Page,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/") ?? [];
    return loadDocsPage(slugs);
  },
});

const serverLoader = createServerFn({
  method: "GET",
})
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) {
      throw notFound();
    }

    return {
      markdownUrl: getPageMarkdownUrl(page).url,
      pageTree: await source.serializePageTree(source.getPageTree()),
      path: page.path,
    };
  });

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: MDX },
    // you can define props for the component
    {
      markdownUrl,
      path,
    }: {
      markdownUrl: string;
      path: string;
    },
  ) {
    return (
      <DocsPage className="*:max-w-[860px]" toc={toc} tableOfContent={{ style: "clerk" }}>
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <div className="flex flex-row gap-2 items-center border-b -mt-4 pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
          <ViewOptionsPopover
            markdownUrl={markdownUrl}
            githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${path}`}
          />
        </div>
        <DocsBody>
          <MDX components={useMDXComponents()} />
        </DocsBody>
      </DocsPage>
    );
  },
});

export async function loadDocsPage(slugs: string[]) {
  const data = await serverLoader({ data: slugs });
  await clientLoader.preload(data.path);
  return data;
}

function Page() {
  return <DocsContent data={Route.useLoaderData()} />;
}

export function DocsContent({ data }: { data: Awaited<ReturnType<typeof loadDocsPage>> }) {
  const { path, pageTree, markdownUrl } = useFumadocsLoader(data);

  const base = baseOptions();

  return (
    <DocsLayout
      {...base}
      nav={{ ...base.nav, mode: "top", component: <DocsNavbar /> }}
      searchToggle={{ enabled: true }}
      slots={{ searchTrigger: false }}
      sidebar={{
        banner: <FullSearchTrigger hideIfDisabled className="w-full" />,
        className: "docs-sidebar border-e",
        collapsible: false,
      }}
      tabMode="navbar"
      tree={pageTree}
    >
      <Suspense>{clientLoader.useContent(path, { markdownUrl, path })}</Suspense>
    </DocsLayout>
  );
}

function DocsNavbar() {
  const pathname = useLocation({ select: (location) => location.pathname });

  const tabs = [
    { href: "/docs/integrate", label: "Embedding TailorKit", splat: "integrate" },
    { href: "/docs/apps", label: "Building Apps", splat: "apps" },
  ] as const;

  return (
    <SiteNavbar docs>
      <div className="h-10 border-b" data-header-tabs="">
        <nav className="mx-auto flex h-full w-full max-w-[97rem] items-end gap-6 px-4">
          {tabs.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);

            return (
              <Link
                className={`inline-flex items-center border-b-2 pb-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "border-fd-primary text-fd-primary"
                    : "border-transparent text-fd-muted-foreground hover:text-fd-accent-foreground"
                }`}
                key={tab.href}
                params={{ _splat: tab.splat }}
                to="/docs/$"
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </SiteNavbar>
  );
}
