/* oxlint-disable react/no-unstable-nested-components */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { flexRender, useTable } from "@tanstack/react-table";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { AppWindowIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Scope } from "@tailorkit/db/schema/scope";
import { Badge } from "@tailorkit/ui/badge";
import { CardFrame } from "@tailorkit/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@tailorkit/ui/empty";
import { Input } from "@tailorkit/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@tailorkit/ui/table";
import { DateAgo } from "@tailorkit/ui/date";
import { AppLogo } from "#components/apps/app-logo";
import { renderSortableHeader } from "#components/members/member-table-utils";
import { PageLayout } from "#components/page-layout";
import { orpc } from "#lib/orpc";
import { dataTableFeatures } from "#lib/table";

const appsPageSize = 25;

function appsListQueryOptions({
  appsList,
  orgSlug,
  projectSlug,
  search,
}: {
  appsList: typeof orpc.apps.list;
  orgSlug: string;
  projectSlug: string;
  search: string;
}) {
  return appsList.infiniteOptions({
    input: (page) => ({
      orgSlug,
      page,
      pageSize: appsPageSize,
      projectSlug,
      search,
    }),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore ? lastPage.pagination.page + 1 : undefined,
    initialPageParam: 1,
  });
}

export const Route = createFileRoute("/(app)/$orgSlug/$projectSlug/apps/")({
  loader: ({ context, params }) =>
    context.queryClient.infiniteQuery(
      appsListQueryOptions({
        appsList: context.orpc.apps.list,
        orgSlug: params.orgSlug,
        projectSlug: params.projectSlug,
        search: "",
      }),
    ),
  component: AppsIndexPage,
});

interface AppRow {
  id: string;
  publicId: string;
  name: string;
  scope: Scope;
  createdAt: Date | string;
  currentDeployment: { status: string } | null;
  deploymentCount: number;
  logoPaths?: { dark?: string; light?: string };
}

function getDeploymentStatusVariant(status?: string): "info" | "outline" | "success" | "warning" {
  if (status === "published") {
    return "success";
  }
  if (status === "deploying" || status === "verifying") {
    return "warning";
  }
  if (status === "uploading") {
    return "info";
  }
  return "outline";
}

function AppsTable({
  apps,
  hasNextPage,
  isFetchingNextPage,
  loadMoreRef,
  orgSlug,
  projectSlug,
}: {
  apps: AppRow[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  orgSlug: string;
  projectSlug: string;
}) {
  const navigate = useNavigate();
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const columns = useMemo<ColumnDef<typeof dataTableFeatures, AppRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "App",
        size: 280,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3">
            <AppLogo
              className="size-9"
              logoPaths={row.original.logoPaths}
              name={row.original.name}
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate font-medium text-sm">{row.original.name}</span>
              <span className="truncate text-muted-foreground text-xs">
                {row.original.publicId}
              </span>
            </div>
          </div>
        ),
      },
      {
        accessorFn: (row) => `${row.scope.name} ${JSON.stringify(row.scope.value)}`,
        id: "scope",
        header: "Scope",
        size: 220,
        cell: ({ row }) => (
          <span
            className="block truncate text-sm"
            title={`${row.original.scope.name}: ${JSON.stringify(row.original.scope.value, null, 2)}`}
          >
            <span className="font-medium">{row.original.scope.name}:</span>{" "}
            {JSON.stringify(row.original.scope.value)}
          </span>
        ),
      },
      {
        accessorKey: "deploymentCount",
        header: "Deployments",
        size: 120,
        cell: ({ row }) => <span className="text-sm">{row.original.deploymentCount}</span>,
      },
      {
        id: "currentDeployment",
        header: "Current",
        size: 140,
        cell: ({ row }) =>
          row.original.currentDeployment ? (
            <Badge
              size="lg"
              variant={getDeploymentStatusVariant(row.original.currentDeployment.status)}
            >
              {row.original.currentDeployment.status}
            </Badge>
          ) : (
            <span className="text-muted-foreground text-sm">None</span>
          ),
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        size: 140,
        sortFn: "datetime",
        cell: ({ row }) => <DateAgo date={row.original.createdAt} />,
      },
    ],
    [],
  );

  const table = useTable({
    columns,
    data: apps,
    enableSortingRemoval: false,
    features: dataTableFeatures,
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <CardFrame className="w-full">
      <Table className="table-fixed" variant="card">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow className="hover:bg-transparent" key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} style={{ width: `${header.column.getSize()}px` }}>
                  {renderSortableHeader(header)}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              className="cursor-pointer"
              key={row.id}
              tabIndex={0}
              onClick={() =>
                navigate({
                  params: { appId: row.original.publicId, orgSlug, projectSlug },
                  to: "/$orgSlug/$projectSlug/apps/$appId",
                })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  navigate({
                    params: { appId: row.original.publicId, orgSlug, projectSlug },
                    to: "/$orgSlug/$projectSlug/apps/$appId",
                  });
                }
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {(isFetchingNextPage || hasNextPage) && (
        <div
          ref={loadMoreRef}
          className="border-t px-4 py-3 text-center text-muted-foreground text-sm"
        >
          {isFetchingNextPage ? "Loading more apps..." : "Scroll for more apps"}
        </div>
      )}
    </CardFrame>
  );
}

function AppsIndexPage() {
  const { orgSlug, projectSlug } = Route.useParams();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } = useInfiniteQuery(
    appsListQueryOptions({
      appsList: orpc.apps.list,
      orgSlug,
      projectSlug,
      search: normalizedSearch,
    }),
  );

  useEffect(() => {
    const loadMoreElement = loadMoreRef.current;
    if (!loadMoreElement || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
        fetchNextPage();
      }
    });

    observer.observe(loadMoreElement);

    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const apps = data?.pages.flatMap((page) => page.items) ?? [];
  const searchControl = (
    <div className="relative w-full sm:w-72">
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="bg-popover [&_[data-slot=input]]:pl-8"
        placeholder="Search apps"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
    </div>
  );
  let content;

  if (isPending) {
    content = (
      <CardFrame className="w-full px-4 py-6 text-center text-muted-foreground text-sm">
        Loading apps...
      </CardFrame>
    );
  } else if (apps.length === 0) {
    content = (
      <Empty className="mx-auto w-full rounded-lg border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AppWindowIcon />
          </EmptyMedia>
          <EmptyTitle>{normalizedSearch ? "No apps found" : "No apps uploaded"}</EmptyTitle>
          <EmptyDescription>
            {normalizedSearch
              ? "Try a different app name, id, scope, or description."
              : "Apps deployed to this project will appear here."}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else {
    content = (
      <AppsTable
        apps={apps}
        hasNextPage={Boolean(hasNextPage)}
        isFetchingNextPage={isFetchingNextPage}
        loadMoreRef={loadMoreRef}
        orgSlug={orgSlug}
        projectSlug={projectSlug}
      />
    );
  }

  return (
    <PageLayout
      actions={searchControl}
      description="Apps uploaded to this project through TailorKit."
      title="Apps"
    >
      {content}
    </PageLayout>
  );
}
