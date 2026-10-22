# Setup

Pagehall runs as a container image with Docker Compose. The setup script installs it in a few minutes and later updates it with one command; [your own Compose file](#installation-with-your-own-compose-file) works as well. After the containers run, the instance is set up once, either through the setup assistant or through configuration.

## Installation with the setup script

Requirements: Linux or macOS with Docker Engine 24 or newer and Docker Compose v2, at least 4 GB of free disk space, and a free port for Pagehall (3000 by default). Download the script of the newest release and run it:

```sh
curl -fsSLO https://github.com/pagehall/pagehall/releases/latest/download/install.sh && bash install.sh
```

The script:

1. checks Docker, Compose, the free disk space and the port, and says exactly what is missing;
2. asks for the installation directory (`/opt/pagehall`, on macOS `~/pagehall`) and the address people open, for example `https://wiki.example.org`;
3. writes `compose.yml` and `.env` and generates the secrets: the database password, the master key, the backup key, the metrics token and the setup code;
4. shows the setup link with the code **before** it downloads the images, so you can copy it while the download runs;
5. downloads and starts Pagehall, waits until `/health/ready` answers and prints the next steps: [a reverse proxy with TLS](reverse-proxy.md) and keeping the keys safe.

For unattended installations, pass every answer as an option:

```sh
bash install.sh --dir /opt/pagehall --url https://wiki.example.org --version 1.4.2 --yes
```

| Option | Meaning |
|---|---|
| `--dir <directory>` | Installation directory. |
| `--url <address>` | Address people open, with `https://` and without a path. |
| `--version <version>` | Version to install; the newest release by default. |
| `--image <reference>` | Another image, for example from a mirror registry. |
| `--port <port>`, `--bind <address>` | Host port and address of Pagehall, `3000` on `127.0.0.1` by default, for a reverse proxy on the same host. |
| `--subnet <cidr>` | Subnet of the Compose network, `172.30.0.0/24` by default. |
| `--proxy <address>` | Fixed address of a reverse proxy that runs in the Compose project, for example `172.30.0.10`. It becomes the only entry of `PAGEHALL_TRUSTED_PROXIES`; never the whole subnet or its gateway, from which every program on the host connects. Without it no proxy is trusted; see [reverse-proxy.md](reverse-proxy.md#forwarded-headers-and-pagehall_trusted_proxies). |
| `--no-pull` | Use an image that is already on the host. |
| `--yes` | Accept every default without asking. |

The installation directory then holds the files below. The script creates it with mode 700, so only its owner (and root, through Docker) can reach the configuration, the secrets and the backups in it; `750` with the group `docker` works as well. It never changes the mode of a directory that already existed: it refuses one that other accounts can write to and warns about one they can read. The container runs as UID 1000, which on many hosts is also the first login account, for example `ubuntu` or `pi`: that account owns `backups/` on the host, so no other host account may be able to open the installation directory.

| File | Content |
|---|---|
| `compose.yml` | The Compose file, with the exact Pagehall version, readable by its owner only (mode 600), also after updates. |
| `.env` | The configuration and the secrets, readable by its owner only (mode 600). Copy it to a safe place: it holds the master key and the backup key, and a backup cannot be restored without them. |
| `backups/` | Backups, among them the ones taken before every update. It belongs to the user of the container (UID 1000) with mode 750; copy backups off the host as root. Temporary files of backups and test restores are not here but in the data volume (`PAGEHALL_WORK_DIR`). |
| `pagehall` | The command for updates, maintenance mode and backups. |
| `.pagehall-install` | The installation method and the installed version, read by the update command. |

The script prints no secret except the setup code. Running it again in an existing installation directory changes nothing: it says that Pagehall is installed there and offers to update it instead.

## Installation with your own Compose file

The Compose file the script writes, for container platforms and for your own setup. Replace `<version>` with a release such as `1.4.2`; never use `latest`, so that a restart does not update by accident.

<!-- compose-file -->
```yaml
name: pagehall

services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: pagehall
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: pagehall
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pagehall -d pagehall"]
      interval: 5s
      timeout: 5s
      retries: 30

  pagehall:
    image: ghcr.io/pagehall/pagehall:<version>
    restart: unless-stopped
    init: true
    stop_grace_period: 45s
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      PAGEHALL_DATABASE_URL: postgres://pagehall:${POSTGRES_PASSWORD}@postgres:5432/pagehall
      PAGEHALL_INSTANCE_URL: ${PAGEHALL_INSTANCE_URL:-}
      PAGEHALL_SETUP_CODE: ${PAGEHALL_SETUP_CODE:-}
      PAGEHALL_MASTER_KEYS: ${PAGEHALL_MASTER_KEYS:-}
      PAGEHALL_BACKUP_KEY: ${PAGEHALL_BACKUP_KEY:-}
      PAGEHALL_METRICS_TOKEN: ${PAGEHALL_METRICS_TOKEN:-}
      PAGEHALL_TRUSTED_PROXIES: ${PAGEHALL_TRUSTED_PROXIES:-}
      PAGEHALL_UPDATE_CHECK: ${PAGEHALL_UPDATE_CHECK:-true}
      PAGEHALL_INSTALL_METHOD: ${PAGEHALL_INSTALL_METHOD:-compose}
      PAGEHALL_INSTALL_DIR: ${PAGEHALL_INSTALL_DIR:-}
    ports:
      - "${PAGEHALL_BIND:-127.0.0.1}:${PAGEHALL_PORT:-3000}:3000"
    volumes:
      - pagehall-data:/var/lib/pagehall
      - ./backups:/var/lib/pagehall/backups
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 10s
      timeout: 5s
      start_period: 300s
      retries: 6

volumes:
  postgres-data:
  pagehall-data:

networks:
  default:
    ipam:
      config:
        - subnet: ${PAGEHALL_SUBNET:-172.30.0.0/24}
```

Put the values into `.env` next to it, with mode 600:

```sh
POSTGRES_PASSWORD=<a long random password>
PAGEHALL_INSTANCE_URL=https://wiki.example.org
PAGEHALL_SETUP_CODE=<optional, at least 12 characters>
PAGEHALL_MASTER_KEYS=1:<32 random bytes in base64>
PAGEHALL_BACKUP_KEY=1:<32 random bytes in base64>
PAGEHALL_TRUSTED_PROXIES=<the fixed address of your reverse proxy, or empty>
```

`head -c 32 /dev/urandom | base64` creates a key. Without `PAGEHALL_MASTER_KEYS` and `PAGEHALL_BACKUP_KEY`, Pagehall generates both into the secrets directory of the data volume; then back up that directory separately. Container templates can offer `PAGEHALL_SETUP_CODE` and `PAGEHALL_INSTANCE_URL` as fields. Every other setting is in [configuration.md](configuration.md). Keep `compose.yml`, `.env` and `backups` in a directory that only you can open, and give `backups` to the user of the container, which runs as UID 1000:

```sh
mkdir -m 700 /opt/pagehall && cd /opt/pagehall
mkdir backups && chown 1000:1000 backups && chmod 750 backups
```

Then start with `docker compose up -d --wait`.

## Updates

An update starts a newer image; Pagehall applies the migrations when it starts. The admin area shows new versions with their changes and the exact commands for your installation under **Instance settings → Updates** (see [operations.md](operations.md#updates)).

### With the update command

```sh
cd /opt/pagehall
./pagehall update
```

`./pagehall update 1.5.0` updates to a given version. The command:

1. downloads the image of the target version, without changing the running instance;
2. shows the breaking changes, manual steps and other changes of every release since the installed version, and stops when the target cannot be reached directly (`Update from … or later` in the [changelog](operations.md#changelog));
3. asks for confirmation (`--yes` skips it);
4. creates a backup of the class "before update" with the running version (`pagehall backup create --before-update`, see [backup.md](backup.md#backups-before-updates)) and stops if that fails, so that the new version does not take a second one when it starts;
5. starts the new version and waits until `/health/ready` answers;
6. reports the result, records the new version and replaces itself with the update command of the new version.

If the new version does not become ready, the command stops, prints the last log lines and the [rollback](#rollback). It never restores anything on its own.

The update command is part of the setup script, so installation and update are the same file and cannot drift apart. It runs on the host, where it can pull images and restart containers, which Pagehall inside its container cannot.

### With your own Compose file

1. Create a backup: `docker compose exec pagehall pagehall backup create --before-update`. It prints where it wrote the backup. Without this step, the new version takes the same backup itself when it starts, before its migrations.
2. Read the breaking changes and manual steps of the new version under **Instance settings → Updates** or with `docker run --rm ghcr.io/pagehall/pagehall:<new version> release-notes --update-from <installed version>`.
3. Change the image in `compose.yml` to the new version, then run `docker compose pull` and `docker compose up -d --wait`.

### Rollback

Migrations only go forward, so going back means restoring the backup from before the update with the previous version. Set the image in `compose.yml` back to the previous version, then:

```sh
cd /opt/pagehall
docker compose stop pagehall
docker compose run --rm pagehall backup restore --input /var/lib/pagehall/backups/<backup before the update> --force
docker compose up -d --wait
```

The update command prints the exact commands with the name of its backup. A backup in S3 storage is downloaded to the `backups` directory first. `--force` replaces the database and the files with the content of the backup; changes made after the backup are lost. The `.env` with the keys stays as it is. See [backup.md](backup.md#commands).

## Setup code

The setup script generates the setup code, writes it to `.env` as `PAGEHALL_SETUP_CODE` and shows the setup link. Without the script, while setup is not complete, every start of an API node prints a link to the setup page with a one-time setup code to the log:

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
