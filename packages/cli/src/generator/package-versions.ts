export interface TemplatePackageVersions {
  drizzleKit: string;
  drizzleOrm: string;
  oxfmt: string;
  oxlint: string;
  preact: string;
  tailorkit: string;
  typescript: string;
  zod: string;
}

// Match the SDK's supported Drizzle v1 snapshot format and runtime version.
export const TEMPLATE_DRIZZLE_VERSION = "1.0.0-rc.4-5d5b77c";

interface PackageVersionRequest {
  fallback: string;
  matcher: string;
  packageName: string;
}

interface SemverVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

const REGISTRY_URL = "https://registry.npmjs.org";
const REGISTRY_TIMEOUT_MS = 5000;

const REQUESTS = {
  oxfmt: { fallback: "^0.46.0", matcher: "^0", packageName: "oxfmt" },
  oxlint: { fallback: "^1.61.0", matcher: "^1", packageName: "oxlint" },
  preact: { fallback: "^11.0.0", matcher: "^11", packageName: "preact" },
  tailorkit: { fallback: "latest", matcher: "^0", packageName: "tailorkit" },
  typescript: { fallback: "^6.0.3", matcher: "^6", packageName: "typescript" },
  zod: { fallback: "^4.0.0", matcher: "^4", packageName: "zod" },
} satisfies Record<
  Exclude<keyof TemplatePackageVersions, "drizzleKit" | "drizzleOrm">,
  PackageVersionRequest
>;

const parseStableVersion = (version: string): SemverVersion | undefined => {
  const match = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u.exec(version);
  if (!match?.groups) {
    return undefined;
  }
  const { major, minor, patch } = match.groups;
  if (!major || !minor || !patch) {
    return undefined;
  }
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
    raw: version,
  };
};

const compareVersions = (a: SemverVersion, b: SemverVersion): number => {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
};

const satisfiesCaretMatcher = (version: SemverVersion, matcher: string): boolean => {
  const match = /^\^(?<major>\d+)(?:\.(?<minor>\d+))?/u.exec(matcher);
  if (!match?.groups?.major) {
    return false;
  }
  const minMajor = Number.parseInt(match.groups.major, 10);
  const minMinor = Number.parseInt(match.groups.minor ?? "0", 10);
  return version.major === minMajor && version.minor >= minMinor;
};

const resolvePackageVersion = async ({
  fallback,
  matcher,
  packageName,
}: PackageVersionRequest): Promise<string> => {
  try {
    const res = await fetch(`${REGISTRY_URL}/${encodeURIComponent(packageName)}`, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    });
    if (!res.ok) {
      return fallback;
    }
    const data = (await res.json()) as { versions?: Record<string, unknown> };
    const latest = Object.keys(data.versions ?? {})
      .map(parseStableVersion)
      .filter((v): v is SemverVersion => v !== undefined)
      .filter((v) => satisfiesCaretMatcher(v, matcher))
      .toSorted(compareVersions)
      .at(-1);
    return latest ? `^${latest.raw}` : fallback;
  } catch {
    return fallback;
  }
};

export const resolveTemplatePackageVersions = async (): Promise<TemplatePackageVersions> => {
  const [oxfmt, oxlint, preact, tailorkit, typescript, zod] = await Promise.all([
    resolvePackageVersion(REQUESTS.oxfmt),
    resolvePackageVersion(REQUESTS.oxlint),
    resolvePackageVersion(REQUESTS.preact),
    resolvePackageVersion(REQUESTS.tailorkit),
    resolvePackageVersion(REQUESTS.typescript),
    resolvePackageVersion(REQUESTS.zod),
  ]);
  return {
    drizzleKit: TEMPLATE_DRIZZLE_VERSION,
    drizzleOrm: TEMPLATE_DRIZZLE_VERSION,
    oxfmt,
    oxlint,
    preact,
    tailorkit,
    typescript,
    zod,
  };
};
