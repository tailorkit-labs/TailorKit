# Releasing TailorKit

TailorKit uses Changesets for versioning, package changelogs, npm publishing, Git tags, and GitHub releases. The repository is intentionally locked to prereleases: the current channel is `beta`, and the publish job rejects every version that is not an `alpha` or `beta`.

## Add a change

Run `vp run changeset`, select the affected public packages, choose the SemVer bump, and describe the user-facing change. Commit the generated Markdown file with the change.

The public packages are versioned as one fixed group so their versions stay aligned. Backend and application-only workspace packages remain private.

## Publish a beta

After changes reach `main`, the `Prerelease` GitHub Actions workflow opens or updates a version PR. That PR contains the prerelease versions and generated `CHANGELOG.md` files. Review and merge it to trigger publishing under npm's `beta` dist-tag and creation of GitHub releases.

Publishing uses npm trusted publishing through GitHub OIDC. Each npm package trusts repository `tailorkit-labs/TailorKit`, workflow `release.yml`, and environment `npm-release`. The version PR job does not receive npm permissions; only the protected publish environment can request an identity token.

Do not run `changeset pre exit` while stable releases are disabled. The publish guard is a second line of defence, but `.changeset/pre.json` is the source of truth for the active channel.
