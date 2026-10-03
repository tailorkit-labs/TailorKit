import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@tailorkit/ui/breadcrumb";
import { Link, useMatches } from "@tanstack/react-router";

interface BreadcrumbSegment {
  href?: string;
  label: string;
}

const accountRouteLabels: Record<string, string> = {
  "/(app)/account/invites": "Invites",
  "/(app)/account/organizations": "Organisations",
  "/(app)/account/profile/": "Profile",
  "/(app)/account/security/": "Security",
};

const settingsRouteLabels: Record<string, string> = {
  "/(app)/$orgSlug/$projectSlug/settings/": "General",
  "/(app)/$orgSlug/$projectSlug/settings/api-keys": "API Keys",
  "/(app)/$orgSlug/~/(org)/settings/": "General",
  "/(app)/$orgSlug/~/(org)/settings/members": "Members",
};

function toLabel(segment: string) {
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function addOrgSegment(params: Record<string, string>, segments: BreadcrumbSegment[]) {
  if (!("orgSlug" in params) || segments.some((s) => s.label === toLabel(params.orgSlug))) {
    return;
  }

  segments.push({
    href: `/${params.orgSlug}/~/projects`,
    label: toLabel(params.orgSlug),
  });
}

function addProjectSegment(
  id: string,
  params: Record<string, string>,
  segments: BreadcrumbSegment[],
) {
  if (!("projectSlug" in params) || segments.some((s) => s.label === toLabel(params.projectSlug))) {
    return;
  }

  const isLast = id.endsWith("/$projectSlug") || id.endsWith("/$projectSlug/");
  segments.push({
    href: isLast ? undefined : `/${params.orgSlug}/${params.projectSlug}`,
    label: toLabel(params.projectSlug),
  });
}

function addStaticSegments(
  id: string,
  params: Record<string, string>,
  segments: BreadcrumbSegment[],
  loaderData: unknown,
) {
  if (id.includes("/account") && !segments.some((s) => s.label === "Account")) {
    segments.push({ href: "/account/profile", label: "Account" });
  }

  if (id.includes("/projects") && !id.includes("$projectSlug")) {
    segments.push({ label: "Projects" });
  }
  if (id.endsWith("/apps")) {
    segments.push({ label: "Apps" });
  }
  if (id.endsWith("/apps/$appId")) {
    const appsSegment = segments.find((segment) => segment.label === "Apps");
    if (appsSegment) {
      appsSegment.href = `/${params.orgSlug}/${params.projectSlug}/apps`;
    } else {
      segments.push({ href: `/${params.orgSlug}/${params.projectSlug}/apps`, label: "Apps" });
    }
    const appName =
      typeof loaderData === "object" &&
      loaderData !== null &&
      "name" in loaderData &&
      typeof loaderData.name === "string"
        ? loaderData.name
        : params.appId;

    segments.push({ label: appName });
  }
  if (id.includes("/support")) {
    segments.push({ label: "Support" });
  }
  if (
    id.includes("/settings") &&
    !id.includes("/account") &&
    !segments.some((s) => s.label === "Settings")
  ) {
    let href = "/account/profile";
    if ("projectSlug" in params) {
      href = `/${params.orgSlug}/${params.projectSlug}/settings`;
    } else if ("orgSlug" in params) {
      href = `/${params.orgSlug}/~/settings`;
    }

    segments.push({ href, label: "Settings" });
  }

  const accountLabel = accountRouteLabels[id];
  if (accountLabel) {
    segments.push({ label: accountLabel });
  }

  const settingsLabel = settingsRouteLabels[id];
  if (settingsLabel) {
    segments.push({ label: settingsLabel });
  }
}

export function NavBreadcrumb() {
  const matches = useMatches();
  const segments: BreadcrumbSegment[] = [];

  for (const match of matches) {
    const id = match.routeId;
    const params = match.params as Record<string, string>;

    if (id === "__root__" || id === "/(app)" || id === "/(auth)") {
      continue;
    }

    addOrgSegment(params, segments);
    addProjectSegment(id, params, segments);
    addStaticSegments(id, params, segments, match.loaderData);
  }

  if (segments.length === 0) {
    return null;
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map((seg, i) => (
          <Fragment key={seg.label}>
            <BreadcrumbItem>
              {seg.href ? (
                <BreadcrumbLink render={<Link to={seg.href} />}>{seg.label}</BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{seg.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {i < segments.length - 1 && <BreadcrumbSeparator />}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
