# Pagehall

Pagehall is a self-hosted wiki, knowledge base and project planning tool for teams and companies. It covers documentation, knowledge sharing and development planning in one application.

Pagehall is free software under the [GNU Affero General Public License v3.0](LICENSE). Every feature is available to every installation. There are no paid tiers, no license keys and no seat counting.

## Status

Pagehall is in development and not ready for use. There are no releases yet.

## Development

Requirements:

- Node.js 24, at least 24.20 (see `.nvmrc`)
- pnpm, through `corepack enable` or a separate installation
- Docker with Docker Compose

Start the development environment:

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts PostgreSQL and all Pagehall processes in Docker with hot reload:

| Process | URL |
|---|---|
| Web client | http://localhost:5173 |
| API | http://localhost:3000/health/ready |
| Collaboration server | http://localhost:3001/health/ready |
| Worker | http://localhost:3002/health/ready |

The environment is ready when `docker compose -f docker/compose.dev.yml ps` shows the `app` service as healthy. Stop it with `pnpm dev:down`.

Checks that also run in CI:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions and [docs/](docs/) for details on the repository layout.

## Use of AI tools

AI tools are used in the development of Pagehall. Every change is reviewed and tested by a maintainer before it is merged, and the maintainer is responsible for it.

## License

Pagehall is licensed under the [AGPL-3.0](LICENSE). Contributions are accepted under the [Developer Certificate of Origin](CONTRIBUTING.md#developer-certificate-of-origin).
