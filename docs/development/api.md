# API description

Every instance serves its API reference at `/api/docs`, built from the OpenAPI description `/api/docs/openapi.json`. The description is generated from the route declarations and Zod schemas in `apps/api`; there is no hand-written description. What the reference offers to script authors is in [getting-started.md](../api/getting-started.md) and [conventions.md](../api/conventions.md).

## Public and internal routes

Internal routes serve only the web client. They are marked with `@InternalRoute()`, follow the same conventions as public routes, but are left out of `/api/docs`. The committed file `apps/api/openapi.json` contains every route, because the web client's types are generated from it (see [web-client.md](web-client.md#api-types)). Internal routes carry `x-lunedo-internal: true` and `x-stability-level: alpha`, so changing them is not a breaking change.

## Regenerating openapi.json

After changing a route or a schema, generate the file again and commit it:

```sh
pnpm --filter @lunedo/api build
pnpm --filter @lunedo/api openapi
```

Regenerate it once at the end of a change, not after every edit. The tests in `apps/api/src/openapi/openapi.test.ts` fail when:

- the committed file differs from the generated one,
- a public route lacks a summary, a description, a tag, a documented error response or an example,
- a field or parameter lacks a description,
- an example does not match its schema,
- a documented error does not use a stable problem type,
- a route does not name its permission.

Integration tests in `apps/api` check every response they receive against the description (`apps/api/src/testing/openapi-validator.ts`).

Content kinds in responses are marked `x-extensible-enum`, so a new content type is not a breaking change for clients.

## API compatibility check

The job "Quick checks" in CI compares `apps/api/openapi.json` of a pull request with the base branch, with [oasdiff](https://github.com/oasdiff/oasdiff) in a container (`scripts/check-api-compatibility.ts`). A breaking change fails the step unless the pull request has the label `breaking-api-change`. Adding or removing that label starts the workflow "Breaking API label" (`.github/workflows/api-label.yml`), which runs the latest CI run of the pull request again, so the result follows the label. See [ci.md](ci.md#quick-checks).

Run the same comparison locally against `origin/main`; it needs Docker:

```sh
node scripts/check-api-compatibility.ts origin/main
```

`pnpm verify` runs it as one of its steps. `--allow-breaking` reports breaking changes without failing. When a breaking change is intended, add the label to the pull request and say in its description what changed.

## Client API level

Every request of the web client carries `X-Lunedo-Client-Api` with the API level of the client (`CLIENT_API_LEVEL` in `packages/shared/src/client-build.ts`). Raise the level when the API changes in a way an open tab of the previous version cannot handle; the server then answers older clients with `409` and the code `clientOutdated`. Requests without the header, such as those of API tokens, are not affected.
