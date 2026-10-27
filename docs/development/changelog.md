# Changelog

`CHANGELOG.md` in the root of the repository is the source of the release notes. The image contains it (`LUNEDO_CHANGELOG_FILE=/app/CHANGELOG.md`). **What's new** on the update page shows the section of the running version from it, the update command reads it to refuse updates that skip a required version, and CI builds the version file of each release from it. The parser is `parseChangelog` in `packages/server/src/operations/changelog.ts`.

## Format

```markdown
## Unreleased

### New

- Maintenance mode for scripted maintenance.

## 1.5.0 · 2026-11-02

Update from 1.3.0 or later.

### New

- An entry that is longer
  continues on lines indented by at least two spaces.

### Improved
### Fixed
### Breaking changes
### Manual steps
```

- Each release is a section `## <version>` with an optional ` · <date>` (a middle dot, then `YYYY-MM-DD`). The version is a release version like `1.5.0`. Changes that are not released yet collect under `## Unreleased`.
- `Update from <version> or later.` is optional. It must come before the first group of the section and names the oldest version that can update to this release directly.
- The groups are `### New`, `### Improved`, `### Fixed`, `### Breaking changes` and `### Manual steps`, each optional, in any case. Any other `###` heading is an error.
- Each entry is a list item `- …`. Lines indented by two or more spaces continue the entry. Other text is ignored.
- Text before the first `##` section, such as the title and the introduction, is ignored.

Limits of the version file: at most 2,000 characters per entry, 200 entries per group and 500 releases.

A heading `## <text>` whose text is neither `Unreleased` nor a version, or an unknown group, makes the parser fail with the line number. Then `lunedo release-notes` fails.

## The command `release-notes`

`lunedo release-notes` runs in the image and needs no database:

```sh
docker run --rm ghcr.io/lunedo/lunedo:1.5.0 release-notes [--since <version>] [--update-from <version>] [--json]
```

| Option | Output |
|---|---|
| none | Every release in the changelog as text, in the order of the file, with breaking changes and manual steps before the other groups. `Unreleased` is left out. |
| `--since <version>` | Only the releases after that version. Prints `No release after <version>.` when there is none. |
| `--update-from <version>` | Like `--since`, after checking that the newest release can be installed from this version. If the newest release names `Update from X or later.` and the version is older than X, it prints which version to install first and exits with 65. |
| `--json` | The version file: `{ "schema": 1, "releases": [...] }` with version, date, minimum version, release URL and the notes of each release. |

Exit codes:

| Code | Meaning |
|---|---|
| 0 | The notes or the version file were written. |
| 65 | `--update-from` names a version that cannot update to the newest release in one step. The setup script's update command stops there and changes nothing. |
| 1 | Any other error, for example an unreadable or invalid changelog or an unknown option. |

## Releases

For every release tag, CI builds the image, runs `release-notes --json` in it to create `lunedo-versions.json` and `release-notes --since <previous tag>` for the text of the GitHub release, and attaches the version file and `scripts/install.sh` to the release. The update check of every instance downloads `lunedo-versions.json` of the latest release.
