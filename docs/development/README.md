# Development

These pages explain how Lunedo is built and how to work on it. Conventions for changes are in [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Quick start

Requirements:

- Node.js 24, at least 24.20 (see `.nvmrc`)
- pnpm, through `corepack enable` or a separate installation
- Docker with Docker Compose

Start the development environment:

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts PostgreSQL and all Lunedo processes in Docker with hot reload:

| Process | URL |
|---|---|
| Web client | http://localhost:5173 |
| API | http://localhost:3000/health/ready |
| Collaboration server | http://localhost:3001/health/ready |
| Worker | http://localhost:3002/health/ready |

The environment is ready when `docker compose -f docker/compose.dev.yml ps` shows the `app` service as healthy. Stop it with `pnpm dev:down`. [environment.md](environment.md) describes the services, ports and setup in detail.

Checks that also run in CI:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

`pnpm verify` runs every check of the CI jobs "Lint, typecheck and checks" and "Quick checks" at once; see [ci.md](ci.md).

## Pages

- [API description](api.md)
- [Architecture](architecture.md)
- [Audit log internals](audit-log.md)
- [Authentication](authentication.md)
- [Authorization](authorization.md)
- [Backup internals](backup.md)
- [Changelog](changelog.md)
- [Continuous integration](ci.md)
- [Real-time collaboration](collaboration.md)
- [Database](database.md)
- [Editor schema](editor-schema.md)
- [Encryption internals](encryption.md)
- [Development environment](environment.md)
- [Identity providers](identity-providers.md)
- [Imports](imports.md)
- [Interface patterns](interface-patterns.md)
- [Knowledge bases](knowledge-bases.md)
- [Notifications](notifications.md)
- [Rendering](rendering.md)
- [Reports and reusable content](reports.md)
- [Repository layout](repository.md)
- [Self-hosted runners](self-hosted-runners.md)
- [Setup internals](setup-internals.md)
- [Stable tests](stable-tests.md)
- [Test identity providers](test-identity-providers.md)
- [Web client](web-client.md)
