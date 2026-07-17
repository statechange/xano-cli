# Releasing `@statechange/xano-cli`

Releases publish from GitHub Actions through npm trusted publishing. The workflow uses a short-lived
OpenID Connect identity; it must not receive an npm token or a `NODE_AUTH_TOKEN` secret. It relies on
npm's default public registry rather than generating a token-placeholder `.npmrc`.

## One-time npm setup

In the npm package settings for [`@statechange/xano-cli`](https://www.npmjs.com/package/@statechange/xano-cli),
configure a GitHub Actions trusted publisher with these exact values:

- Organization or user: `statechange`
- Repository: `xano-cli`
- Workflow filename: `publish.yml`
- Environment: leave blank
- Allowed action: `npm publish`

The workflow filename is case-sensitive and names only the file, not `.github/workflows/publish.yml`.
The workflow must already exist on the default branch before saving this relationship.

## Publish a release

1. Start a release branch from an up-to-date `main` branch.
2. Choose a new semantic version that does not exist on
   [npm](https://www.npmjs.com/package/@statechange/xano-cli?activeTab=versions).
3. Run `npm version <major|minor|patch> --no-git-tag-version`. This updates `package.json` and
   `package-lock.json` without creating a tag before review.
4. Commit the version files, merge them through a pull request, and update local `main` to the merged
   commit.
5. Create a GitHub Release from that exact `main` commit, using a new `v<version>` tag, and publish it.
   Do not mark it as a prerelease, and do not move or recreate a published tag.
6. Confirm the **Publish Package** workflow passes, then verify the new npm version links its
   provenance to `statechange/xano-cli` and `.github/workflows/publish.yml`.

Publication fails before the publish step when the release tag does not exactly equal the `v`-prefixed
`package.json` version, when that version already exists in the registry, or when the packed artifact
omits the README, bundled skills, or CLI entry point. Tests and a clean TypeScript build also gate
publication. The release commit must be contained in the repository's default branch, and the exact
tarball that passes inspection is the one sent to npm. Prereleases are rejected rather than silently
assigning an unstable version to npm's `latest` dist-tag.

After the first OIDC release succeeds, remove any obsolete npm automation secret from GitHub and
revoke its token on npm. npm recommends setting package publishing access to require two-factor
authentication and disallow traditional tokens after trusted publishing is proven.

## Recovery

npm package versions are immutable. If a release fails before publication, fix the release commit,
choose a new version and tag, and publish a new GitHub Release. If npm accepted the version but a later
workflow step appears failed, inspect the registry before retrying; the registry-version gate will
intentionally refuse to republish the same version.
