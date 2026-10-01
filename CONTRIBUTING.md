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
- A pull request that adds a dependency explains why it is needed, names its license and confirms that it is actively maintained.
- Everything that ships in the container image or the web client must use an OSI-approved license. Data packages and dependencies used only for building or testing may use open data licenses such as CC0-1.0 or CC-BY-4.0 when they are listed in `license-allowlist.json` with their license and a reason. `pnpm licenses:check` enforces this in CI.

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

This adds a `Signed-off-by` line with your name and e-mail address. It must match the commit author. CI checks every commit of a pull request; pull requests opened by Dependabot are exempt. There is no Contributor License Agreement.

`pnpm install` sets `core.hooksPath` to `.githooks`, whose `commit-msg` hook rejects a commit without a sign-off by its author, so a missing sign-off is caught before it reaches a pull request. The hooks also reject references to the maintainers' internal planning documents in files and commit messages; CI runs the same check with `pnpm references:check`.

## Code style

- TypeScript in strict mode everywhere. Avoid `any`; where it cannot be avoided, the reason is visible in the same line.
- Biome formats and lints the whole repository. ESLint runs only the type-aware rules `no-floating-promises` and `no-misused-promises`, which Biome cannot check reliably. `pnpm lint` runs both; `pnpm lint:fix` applies Biome fixes.
- The compiler is TypeScript 7. typescript-eslint does not support it yet, so the root package installs TypeScript 6 under the name `typescript` for ESLint only. This alias is removed as soon as typescript-eslint supports TypeScript 7.1.
- Code, identifiers, comments and documentation are in English. Use the terms of the product consistently and do not invent words.
- Comments are rare. They explain what the code cannot express, briefly and factually. No step markers, no restating what the next line does, no commented-out code.
- The web client uses the design tokens from `packages/tokens` through the generated Tailwind theme. Components never use raw colors, sizes or shadows.
- Every user-facing text is translatable and ships in English and German.

## Tests

Every change comes with tests.

- Unit tests use Vitest: `pnpm test`.
- End-to-end tests use Playwright: `pnpm test:e2e`.
- Integration tests run against a real PostgreSQL. Set `PAGEHALL_TEST_DATABASE_URL`, for example to the database of the development environment, to include them locally. Mail tests also need `PAGEHALL_TEST_MAILPIT_URL=http://localhost:8025`. CI always runs them.
- Authentication, permissions, encryption and imports require thorough tests of both allowed and denied cases.

`pnpm lint`, `pnpm typecheck` and `pnpm test` must pass before a pull request is reviewed.

## AI tools

You may use AI tools when contributing. You must understand, test and take responsibility for every line you submit, as with any other code. The pull request template has an optional checkbox to mark AI assistance. It is informational and does not change how the pull request is reviewed.

## Code of conduct

Everyone taking part in the project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
