# Setup internals

How the setup assistant works inside: the state it keeps, the step framework, the code and the session, and the internal endpoints. The operator view is in [Setup assistant](../admin/setup-assistant.md), [System check](../admin/system-check.md) and [Setup through configuration](../admin/setup-through-configuration.md).

## State

The setup state is stored in the database, so all nodes agree on it:

- The `instance` row (ID 1) holds `setup_completed_at`, `setup_completed_through` (`assistant` or `configuration`), the owner account, and the SHA-256 hash of the current setup code with the time it was issued.
- `setup_steps` holds one row per step with its JSON state and `completed_at`. The system check keeps its pending probes and the last reachability result in its row.
- `setup_sessions` holds the hashed session tokens with their origin and expiry.

`SetupService` (`packages/server/src/setup/setup-service.ts`) caches only the fact that setup is complete. Every action runs in one transaction under the advisory lock of the setup, so two nodes or two tabs cannot complete the same step twice.

## Steps

Steps are registered in a `SetupRegistry` (`packages/server/src/setup/framework.ts`). A step has a camelCase `id`, an `order`, a `required` flag, a `describe` function that returns its details for `GET /api/v1/setup/steps`, and named actions with a Zod input schema. The registry rejects IDs and action names that are not camelCase and steps registered twice. The input and detail schemas are shared with the web client through `setupStepSchemas` in `packages/shared/src/setup.ts`.

The built-in steps are in `packages/server/src/setup/steps.ts`:

| Step | Order | Actions |
|---|---|---|
| `instance` | 10 | `save` |
| `systemCheck` | 20 | `acknowledge` |
| `owner` | 30 | `createAccount`, `beginTotp`, `confirmTotp` |
| `keyBackup` | 40 | `download`, `confirm` |
| `organization` | 50 | `save` |

An action receives a context with the transaction, the request's protocol and host, the stored state, `setState`, `complete` and `reopen`. Changing the owner account with `createAccount` reopens the step, removes the second factors, recovery codes and sessions of the owner and resets `keyBackup`, so the emergency kit must be downloaded again. `keyBackup/download` answers with the kit once; a second call fails with `keysAlreadyDownloaded`.

Each check of the system check returns `status` (`ok`, `info`, `warning` or `error`), `cause`, `fixCommand` and `docs`, plus facts such as `path`, `processUid`, `offsetMs` or `toleranceMs`. The reachability check stores a challenge that lives 60 seconds, reads at most 1 KiB of the answer, and keeps its result in the step state once the step is completed and the address has not changed.

Setup through configuration (`packages/server/src/setup/configured.ts`) creates the same records in one locked transaction, completes every built-in step and marks the setup complete with `configuration`.

## Code and session

- The API issues the code at every start while setup is not complete. A generated code has 16 characters from a 32-character alphabet without `I`, `L`, `O` and `U`, grouped in fours. Only its hash is stored, computed over the upper-cased code without spaces and hyphens.
- `POST /api/v1/setup/session` exchanges the code for a session token and clears the hash, so the code works once. It is limited to 10 attempts per client address in 15 minutes.
- The token is set in the cookie `__Host-lunedo-setup` (one day). A session ends after an hour without use and a day after it started.
- `POST /api/v1/setup/complete` completes the setup, clears the setup cookie and signs the owner in with a full session.

## Endpoints

All endpoints are internal and hidden from `/api/docs`. After setup, every endpoint except the restore status answers `404` like a route that does not exist.

| Endpoint | Access |
|---|---|
| `GET /api/v1/setup` | public until setup is complete |
| `POST /api/v1/setup/session` with `{ "code": "..." }` | public until setup is complete |
| `GET /api/v1/setup/probe/{challenge}` | public until setup is complete; answers only a challenge of a running system check |
| `GET /api/v1/setup/steps` | setup session |
| `POST /api/v1/setup/steps/{step}/{action}` | setup session |
| `POST /api/v1/setup/complete` | setup session |
| `GET /api/v1/setup/restore/sources`, `POST /api/v1/setup/restore/s3` | setup session |
| `POST /api/v1/setup/restore/uploads`, `GET` and `PUT /api/v1/setup/restore/uploads/{uploadId}` | setup session |
| `POST /api/v1/setup/restore` | setup session |
| `GET /api/v1/setup/restore/status` | the browser that started the restore, through the cookie `__Host-lunedo-restore` (one day), also after the restart and after setup |

Actions: `instance/save`, `systemCheck/acknowledge`, `owner/createAccount`, `owner/beginTotp`, `owner/confirmTotp`, `keyBackup/download`, `keyBackup/confirm`, `organization/save`. `POST /api/v1/setup/complete` answers whether a mail server is set up (`mailConfigured`).

## Restore during the setup

`packages/server/src/setup/restore.ts` runs the restore in the API process that received it. Uploads arrive in parts of at most 8 MiB. The progress is kept in `setup-restore.json` in `LUNEDO_WORK_DIR` and shown for a day. When the restore is complete, every process of the instance ends itself gracefully so that the container restarts with the restored data and keys. The operator view is in [Restore](../admin/backups/restore.md).
