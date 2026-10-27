# Repository layout

Lunedo is one pnpm workspace with five applications and seven packages. This page says where things live; the other pages in this folder explain each part.

## Folders

| Path | Contents |
|---|---|
| `apps/web` | Browser client: React, Vite, Tailwind CSS, Tiptap and Excalidraw. See [web-client.md](web-client.md). |
| `apps/api` | HTTP API: NestJS on Fastify, Drizzle ORM. It also serves the built web client and the API reference. See [api.md](api.md). |
| `apps/collab` | Real-time collaboration server: Hocuspocus. See [collaboration.md](collaboration.md). |
| `apps/worker` | Background jobs and the command line tools of the image (`backup`, `keys`, `audit`, `search`, `maintenance`, `version`, `release-notes`). |
| `apps/render` | Optional render container: headless Chromium that turns print-ready HTML into PDF. See [rendering.md](rendering.md). |
| `packages/editor-schema` | Document model shared by client, server, importers and exporters. See [editor-schema.md](editor-schema.md). |
| `packages/fractional-indexing` | Order keys between two keys, compatible with the `fractional-indexing` package that Excalidraw uses. `pnpm-workspace.yaml` replaces that package with this one through an override. |
| `packages/shared` | Types, Zod schemas and utilities used by client and server. |
| `packages/server` | Server foundation used by API, collaboration server and worker: configuration, database, encryption, settings, jobs, authorization, imports, search, backups and every other domain module. |
| `packages/ui` | Interface components. `/dev/components` shows each of them in every state. |
| `packages/tokens` | Design tokens and the generated theme. |
| `packages/config` | Shared TypeScript and Vitest configuration, the development runner `lunedo-dev` and the parallelism rules for tests. |
| `docker` | Container images, the Compose files for development and CI, the test identity providers (`docker/idp`) and `docker/runtime`, the packages the bundled server loads at runtime. |
| `scripts` | Repository checks, CI helpers, the development commands and the installation script. Their tests run with `node --test`. |
| `patches` | Patches of dependencies, listed under `patchedDependencies` in `pnpm-workspace.yaml`. `pnpm patches:check` fails when a patched dependency changes, so the patch is checked again. |
| `.githooks` | Git hooks, see [environment.md](environment.md#git-hooks). |
| `.github` | Workflows and the Dependabot configuration, see [ci.md](ci.md). |
| `docs` | Documentation. `docs/development` is for people who work on the code. |

## Workspace and build

The workspace is managed with pnpm and Turborepo. `pnpm build`, `pnpm typecheck` and `pnpm test` run the task in every package; a package's tasks first build the packages it depends on.

The compiler is TypeScript 7 (`tsc` from `@typescript/native`). typescript-eslint does not support its API yet, so the root package also installs TypeScript 6 under the name `typescript` for ESLint only. ESLint runs only the type-aware promise rules; Biome does formatting and all other linting (`pnpm lint`, `pnpm format`).

Packages are built to `dist` with `tsc`. Vite and Vitest read package sources directly through the `@lunedo/source` export condition, so changes in `packages/ui`, `packages/shared` or `packages/editor-schema` reach the web client and the tests without a rebuild. `packages/tokens` generates `generated/theme.css` when it builds; the folder is not committed.

The image does not ship the workspace. `scripts/bundle-server.ts` bundles the API, the collaboration server, the worker and the command line tools with esbuild, and `docker/runtime` holds the few packages that are read at runtime, such as `sharp` and `pdfjs-dist`.

## Where to read on

- [environment.md](environment.md): start the development environment.
- [architecture.md](architecture.md): processes, data and the container image.
- [ci.md](ci.md): what CI checks and how to run the same checks locally.
- [interface-patterns.md](interface-patterns.md): rules for new screens.
