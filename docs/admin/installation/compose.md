# Installation with your own Compose file

Use your own Compose file for container platforms, templates or a setup you manage yourself. It is the same file the [setup script](script.md) writes; `bash install.sh print-compose --version 1.4.2` prints it with the version filled in. Check the [requirements](../requirements.md) first.

## Compose file

Replace `<version>` with a release such as `1.4.2`. Never use `latest`, so that a restart does not update by accident.

<!-- compose-file -->
```yaml
name: lunedo

services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    shm_size: 1gb
    environment:
      POSTGRES_USER: lunedo
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: lunedo
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lunedo -d lunedo"]
      interval: 5s
      timeout: 5s
      retries: 30

  lunedo:
    image: ghcr.io/lunedo/lunedo:<version>
    restart: unless-stopped
    init: true
    stop_grace_period: 45s
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      LUNEDO_DATABASE_URL: postgres://lunedo:${POSTGRES_PASSWORD}@postgres:5432/lunedo
      LUNEDO_INSTANCE_URL: ${LUNEDO_INSTANCE_URL:-}
      LUNEDO_SETUP_CODE: ${LUNEDO_SETUP_CODE:-}
      LUNEDO_MASTER_KEYS: ${LUNEDO_MASTER_KEYS:-}
      LUNEDO_BACKUP_KEY: ${LUNEDO_BACKUP_KEY:-}
      LUNEDO_METRICS_TOKEN: ${LUNEDO_METRICS_TOKEN:-}
      LUNEDO_TRUSTED_PROXIES: ${LUNEDO_TRUSTED_PROXIES:-}
      LUNEDO_UPDATE_CHECK: ${LUNEDO_UPDATE_CHECK:-true}
      LUNEDO_INSTALL_METHOD: ${LUNEDO_INSTALL_METHOD:-compose}
      LUNEDO_INSTALL_DIR: ${LUNEDO_INSTALL_DIR:-}
    ports:
      - "${LUNEDO_BIND:-127.0.0.1}:${LUNEDO_PORT:-3000}:3000"
    volumes:
      - lunedo-data:/var/lib/lunedo
      - ./backups:/var/lib/lunedo/backups
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 10s
      timeout: 5s
      start_period: 300s
      retries: 6

volumes:
  postgres-data:
  lunedo-data:

networks:
  default:
    ipam:
      config:
        - subnet: ${LUNEDO_SUBNET:-172.30.0.0/24}
```

The file runs PostgreSQL and Lunedo in the role `all`. Lunedo publishes its port on `127.0.0.1:3000` for a reverse proxy on the same host, keeps its data in the volume `lunedo-data` and its backups in `./backups`. `stop_grace_period: 45s` gives running requests and jobs the default shutdown timeout of 30 seconds plus 10 seconds to hand jobs back; see [Shutdown](../configuration.md#shutdown).

## The .env file

Put the values into `.env` next to `compose.yml`:

```sh
POSTGRES_PASSWORD=<a long random password>
LUNEDO_INSTANCE_URL=https://wiki.example.com
LUNEDO_SETUP_CODE=<optional, at least 12 characters>
LUNEDO_MASTER_KEYS=1:<32 random bytes in base64>
LUNEDO_BACKUP_KEY=1:<32 random bytes in base64>
LUNEDO_METRICS_TOKEN=<a long random token>
LUNEDO_TRUSTED_PROXIES=<the fixed address of your reverse proxy, or empty>
```

The Compose file reads these variables from it:

| Variable | Default | Meaning |
|---|---|---|
| `POSTGRES_PASSWORD` | required | Password of the database user `lunedo`. The Compose file builds `LUNEDO_DATABASE_URL` from it. |
| `LUNEDO_INSTANCE_URL` | empty | The address people open, without a path. See [Instance address](../instance-address.md). |
| `LUNEDO_SETUP_CODE` | empty | A setup code of your own; without it, Lunedo prints a generated one to the log. See [Setup assistant](../setup-assistant.md#setup-code). |
| `LUNEDO_MASTER_KEYS` | empty | The master key ring. Without it, Lunedo generates one into the secrets directory of the data volume. |
| `LUNEDO_BACKUP_KEY` | empty | The backup key ring. Without it, Lunedo generates one into the secrets directory of the data volume. |
| `LUNEDO_METRICS_TOKEN` | empty | Bearer token for `/metrics`. Without it, Lunedo generates one into the secrets directory. |
| `LUNEDO_TRUSTED_PROXIES` | empty | The one address of a reverse proxy in this Compose project. See [Forwarded headers](../reverse-proxy.md#forwarded-headers-and-lunedo_trusted_proxies). |
| `LUNEDO_UPDATE_CHECK` | `true` | `false` turns the [update check](../updates.md#update-check) off completely. |
| `LUNEDO_INSTALL_METHOD` | `compose` | How Lunedo was installed; **Settings › Instance › Operations › Updates** shows the update commands for it. |
| `LUNEDO_INSTALL_DIR` | empty | The directory of `compose.yml` on the host, shown in the update commands. |
| `LUNEDO_BIND` | `127.0.0.1` | Host address the port listens on. |
| `LUNEDO_PORT` | `3000` | Host port of Lunedo. |
| `LUNEDO_SUBNET` | `172.30.0.0/24` | Subnet of the Compose network. |

Every other variable is listed in [Environment variables](../environment-variables.md); add it to the `environment` of the `lunedo` service.

Create each key, and the metrics token, with:

```sh
head -c 32 /dev/urandom | base64
```

Without `LUNEDO_MASTER_KEYS` and `LUNEDO_BACKUP_KEY`, back up the secrets directory of the data volume separately from the backups: a backup cannot be restored without its keys. Container templates can offer `LUNEDO_SETUP_CODE` and `LUNEDO_INSTANCE_URL` as fields.

## Start

1. Create a directory that only you can open, and give `backups` to the user of the container, which runs as UID 1000:

   ```sh
   mkdir -m 700 /opt/lunedo && cd /opt/lunedo
   mkdir backups && chown 1000:1000 backups && chmod 750 backups
   ```

2. Put `compose.yml` and `.env` into it, and restrict `.env` with `chmod 600 .env`.
3. Start Lunedo:

   ```sh
   docker compose up -d --wait
   ```

4. Read the setup link from the log and open it; see [Setup assistant](../setup-assistant.md#setup-code).
5. Put a [reverse proxy with TLS](../reverse-proxy.md) in front of Lunedo.

Updates with your own Compose file are described in [Updates](../updates.md#with-your-own-compose-file).
