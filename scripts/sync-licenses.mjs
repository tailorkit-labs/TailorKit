import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const licensesDir = path.join(root, "licenses");
const checkOnly = process.argv.includes("--check");

function findPackageManifests(directory) {
  const manifests = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.name === ".git" ||
      entry.name === "node_modules" ||
      entry.name === ".turbo" ||
      entry.name === ".next" ||
      entry.name === ".output" ||
      entry.name === "dist" ||
      entry.name === "build"
    ) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      manifests.push(...findPackageManifests(entryPath));
    } else if (entry.name === "package.json") {
      manifests.push(entryPath);
    }
  }

  return manifests;
}

function relativeToRoot(filePath) {
  return path.relative(root, filePath) || ".";
}

const errors = [];
const packages = findPackageManifests(root)
  .filter((manifestPath) => manifestPath !== path.join(root, "package.json"))
  .toSorted();

for (const manifestPath of packages) {
  const packageDirectory = path.dirname(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const packageLabel = manifest.name ?? relativeToRoot(packageDirectory);

  if (typeof manifest.license !== "string" || manifest.license.length === 0) {
    errors.push(
      `${packageLabel}: missing a string license field in ${relativeToRoot(manifestPath)}`,
    );
    continue;
  }

  const sourcePath = path.join(licensesDir, `${manifest.license}.md`);
  const targetPath = path.join(packageDirectory, "LICENSE.md");

  if (!fs.existsSync(sourcePath)) {
    errors.push(`${packageLabel}: missing canonical license ${relativeToRoot(sourcePath)}`);
    continue;
  }

  const source = fs.readFileSync(sourcePath, "utf-8");
  const target = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf-8") : null;

  if (checkOnly) {
    if (target === null) {
      errors.push(`${packageLabel}: missing ${relativeToRoot(targetPath)}`);
    } else if (target !== source) {
      errors.push(
        `${packageLabel}: ${relativeToRoot(targetPath)} is out of sync with ${relativeToRoot(sourcePath)}`,
      );
    }
  } else if (target !== source) {
    fs.writeFileSync(targetPath, source);
    console.log(`Updated ${relativeToRoot(targetPath)} (${manifest.license})`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else if (checkOnly) {
  console.log(`Verified ${packages.length} package license files.`);
} else {
  console.log(`Synchronized ${packages.length} package license files.`);
}
