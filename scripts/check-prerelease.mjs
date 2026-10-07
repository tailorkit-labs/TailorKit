import { readFile } from "node:fs/promises";

const publishablePackages = [
  "packages/tailorkit/package.json",
  "packages/app/package.json",
  "packages/cli/package.json",
  "packages/client-core/package.json",
  "packages/client-platform/package.json",
  "packages/core/package.json",
  "packages/react/package.json",
  "packages/sandbox/package.json",
];

const allowedPrerelease = /-(?:alpha|beta)(?:\.|$)/u;
const releaseRepository = process.env.GITHUB_REPOSITORY ?? "tailorkit-labs/TailorKit";
const expectedRepositoryUrl = `git+https://github.com/${releaseRepository}.git`;
const errors = [];
const manifests = [];

for (const manifestPath of publishablePackages) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
  manifests.push(manifest);

  if (manifest.private === true) {
    errors.push(`${manifest.name} is still private`);
  }

  if (!allowedPrerelease.test(manifest.version)) {
    errors.push(`${manifest.name}@${manifest.version} is not an alpha or beta prerelease`);
  }

  if (manifest.publishConfig?.access !== "public") {
    errors.push(`${manifest.name} does not publish with public access`);
  }

  if (manifest.repository?.url !== expectedRepositoryUrl) {
    errors.push(
      `${manifest.name} repository.url must be ${expectedRepositoryUrl} for trusted publishing`,
    );
  }
}

const publishableNames = new Set(manifests.map((manifest) => manifest.name));
const versions = new Set(manifests.map((manifest) => manifest.version));

if (versions.size !== 1) {
  errors.push("The fixed public package group does not share one version");
}

for (const manifest of manifests) {
  const publishedDependencies = {
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  };

  for (const [dependency, range] of Object.entries(publishedDependencies)) {
    if (range.startsWith("workspace:") && !publishableNames.has(dependency)) {
      errors.push(`${manifest.name} has an unpublished workspace dependency on ${dependency}`);
    }
  }
}

const preState = JSON.parse(await readFile(".changeset/pre.json", "utf-8"));

if (preState.mode !== "pre" || !["alpha", "beta"].includes(preState.tag)) {
  errors.push("Changesets must remain in alpha or beta prerelease mode");
}

if (errors.length > 0) {
  console.error("Prerelease safety check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Prerelease safety check passed (${preState.tag} channel).`);
}
