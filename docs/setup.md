# Setup

A new instance is set up once, either through the setup assistant or through configuration.

## Setup code

While setup is not complete, every start of an API node prints a link to the setup page with a one-time setup code to the log:

```
Setup link: https://wiki.example.org/setup#code=7KQ2-M9XA-P4RT-HB3C. Open it in a browser to set up the instance.
```

Read it with `docker compose logs pagehall | grep "Setup link"`. The link uses `PAGEHALL_INSTANCE_URL`, otherwise the instance URL stored by the assistant. Without either, it shows only the path, `/setup#code=…`, to be prefixed with the address of the server. `PAGEHALL_INSTANCE_URL` set on its own also fills the instance step, where it cannot be changed; it does not start setup through configuration. The code is in the URL fragment, which browsers do not send to the server, so it does not reach proxy or access logs. The setup page takes the code from the fragment, fills it in and removes the fragment from the address bar.

A new start issues a new code and the earlier one stops working, so with several API nodes use the newest code. The code works once and proves that whoever runs the assistant operates the server. It is the only secret Pagehall ever writes to its log. Exchanges are limited to 10 per client in 15 minutes; the code has 80 bits, so it cannot be guessed.

Instead, the code can be set with `PAGEHALL_SETUP_CODE` or `PAGEHALL_SETUP_CODE_FILE`, for example as a field in a container template. It needs at least 12 characters, not counting spaces and hyphens; a shorter value stops the start. Pagehall then uses it instead of a generated code and does not print it. Like a generated code, it works once per start. Once setup is complete it is ignored, and every start logs that the variable can be removed. Letters are compared without regard to case, and spaces and hyphens are ignored.

The code is exchanged for a setup session, held in the cookie `__Host-pagehall-setup`. A setup session ends after an hour without use and a day after the code was entered.

## Steps

Steps are registered by the modules; the assistant shows them in order:

| Step | Required | Content |
|---|---|---|
| `systemCheck` | yes | Database version and migrations, file storage, instance URL, HTTPS, clock difference between application and database. Warnings do not block setup. |
| `instance` | yes | Instance URL and name. |
| `owner` | yes | Owner account with password and TOTP, then ten recovery codes. The step can be repeated until setup is complete. |
| `keyBackup` | yes | One-time download of the master keys and backup keys, then a confirmation that they are stored safely. |
| `organization` | yes | The first organization with name, language, time zone and formats. The owner becomes its owner and has it as home organization. |

E-mail is set up afterwards in the instance settings. Until then, the instance overview shows that invitations and e-mail notifications are not sent.

The organization step proposes date format, time format, number format and first day of the week from the language and time zone it opens with: German gets `DD.MM.YYYY`, 24-hour time, `de-DE` numbers (`de-CH` in Swiss time zones) and Monday; English in time zones of the Americas gets `MM/DD/YYYY`, 12-hour time, `en-US` and Sunday, otherwise `DD/MM/YYYY`, 24-hour time, `en-US` and Monday. The proposal is shown for confirmation and stored at the organization level. Choosing another language in the step does not change the formats.

The setup state is stored in the database, so all nodes agree on it.

## System check

Every `GET /api/v1/setup/steps` runs all checks again. Each check reports a `status` (`ok`, `warning` or `error`), a `cause` code when it did not pass, a `fixCommand` when a shell command fixes the cause, and `docs`, the section below that explains it. Errors block the setup; warnings do not.

### Database

`unreachable`: the database did not answer. Check `PAGEHALL_DATABASE_URL` and that PostgreSQL runs. `migrationsPending`: the schema is older than this version of Pagehall. Restart the API; it applies migrations at start.

### Clock

`offset`: the clocks of Pagehall and the database differ by more than `toleranceMs` (5 seconds). Time-based codes and session expiry depend on matching clocks; synchronize both hosts with NTP. `unknown`: the database could not be asked for its time.

### File storage

The check writes and removes a file in `PAGEHALL_FILES_DIR` and reports the `path`, whether it `exists`, the user and group Pagehall runs as (`processUid`, `processGid`) and the owner of the directory (`ownerUid`, `ownerGid`).

- `missing`: the directory does not exist. Create it and give it to the user Pagehall runs as, for example `mkdir -p /var/lib/pagehall/files && chown 1000:1000 /var/lib/pagehall/files`.
- `notWritable`: the user Pagehall runs as cannot write to it, usually because a mounted volume belongs to another user. Change the owner, for example `chown -R 1000:1000 /var/lib/pagehall/files`, on the host for a bind mount or with `docker compose exec -u root pagehall` for a volume.
- `lowSpace`: less than 1 GiB is free.

### Instance URL

`notSet`: neither the instance step nor `PAGEHALL_INSTANCE_URL` has set the address of the instance yet. When `PAGEHALL_INSTANCE_URL` is set, the check shows it as configured until the instance step stores an address.

### HTTPS

`instanceUrlNotHttps`: the instance URL, stored or from `PAGEHALL_INSTANCE_URL`, does not start with `https:`. Once an instance URL is known, only that address is checked, not the address the setup is opened with. `requestNotHttps`: no instance URL is known and the request reached Pagehall without TLS, or a reverse proxy is not listed in `PAGEHALL_TRUSTED_PROXIES` and its `X-Forwarded-Proto` header is ignored. Run Pagehall behind a reverse proxy with TLS before inviting people.

## Endpoints

All endpoints are internal. After setup they answer `404` like routes that do not exist.

| Endpoint | Access |
|---|---|
| `GET /api/v1/setup` | public until setup is complete |
| `POST /api/v1/setup/session` with `{ "code": "..." }` | public until setup is complete |
| `GET /api/v1/setup/steps` | setup session |
| `POST /api/v1/setup/steps/{step}/{action}` | setup session |
| `POST /api/v1/setup/complete` | setup session |

Actions: `systemCheck/acknowledge`, `instance/save`, `owner/createAccount`, `owner/beginTotp`, `owner/confirmTotp`, `keyBackup/download`, `keyBackup/confirm`, `organization/save`.

## Setup through configuration

All values can be given through configuration instead, see [configuration.md](configuration.md#setup-through-configuration). The assistant is then skipped and no setup code is printed. The owner sets up a second factor at the first sign-in, and the keys must be backed up by the operator.
