# Contributing to Pagehall

Thank you for your interest in Pagehall. This document describes how to set up the project and what a contribution needs before it can be merged.

Questions and ideas belong in GitHub Discussions. Bugs are reported as issues. Security vulnerabilities are reported privately as described in [SECURITY.md](SECURITY.md).

## Setup

Requirements: Node.js 24 (see `.nvmrc`), pnpm through `corepack enable`, Docker with Docker Compose.

```sh
pnpm install
pnpm dev
```

The development environment runs in Docker and watches files by polling, so it works with bind mounts on Windows and macOS. See [docs/development.md](docs/development.md) for the processes, ports and configuration.

## Branches and pull requests

- `main` is protected. Work happens on short-lived branches such as `feat/page-history` or `fix/search-excerpts`.
- Pull requests are merged with squash merge after review and green CI.
- Keep pull requests focused on one change. Large changes are discussed in an issue or discussion first.
- A pull request that adds a dependency explains why it is needed, names its license and confirms that it is actively maintained. Only dependencies under OSI-approved licenses are accepted; CI checks this.

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) with a short subject in imperative mood:

```
feat(auth): add passkey sign-in
fix(search): respect page restrictions in excerpts
```

A commit contains one logical change. Add a body only when the reason for the change is not obvious, and keep it brief.

## Developer Certificate of Origin

Every commit must be signed off to certify that you wrote the change or have the right to submit it under the project license, as stated in the [Developer Certificate of Origin](https://developercertificate.org/). Sign off with:

```sh
git commit -s
```

This adds a `Signed-off-by` line with your name and e-mail address. It must match the commit author. CI checks every commit of a pull request. There is no Contributor License Agreement.

## Code style

- TypeScript in strict mode everywhere. Avoid `any`; where it cannot be avoided, the reason is visible in the same line.
- Biome formats and lints the whole repository. Run `pnpm lint:fix` before committing.
- Code, identifiers, comments and documentation are in English. Use the terms of the product consistently and do not invent words.
- Comments are rare. They explain what the code cannot express, briefly and factually. No step markers, no restating what the next line does, no commented-out code.
- The web client uses the design tokens from `packages/tokens` through the generated Tailwind theme. Components never use raw colors, sizes or shadows.
- Every user-facing text is translatable and ships in English and German.

## Tests

Every change comes with tests.

- Unit tests use Vitest: `pnpm test`.
- End-to-end tests use Playwright: `pnpm test:e2e`.
- Integration tests run against a real PostgreSQL. Set `PAGEHALL_TEST_DATABASE_URL`, for example to the database of the development environment, to include them locally. CI always runs them.
- Authentication, permissions, encryption and imports require thorough tests of both allowed and denied cases.

`pnpm lint`, `pnpm typecheck` and `pnpm test` must pass before a pull request is reviewed.

## AI tools

You may use AI tools when contributing. You must understand, test and take responsibility for every line you submit, as with any other code. The pull request template has an optional checkbox to mark AI assistance. It is informational and does not change how the pull request is reviewed.

## Code of conduct

Everyone taking part in the project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
