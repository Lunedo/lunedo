# Installation with the setup script

The setup script installs Lunedo with Docker Compose on one Linux host and later updates it with one command. It refuses to run on macOS. Check the [requirements](../requirements.md) first: Docker Engine 24 or newer with Docker Compose v2, at least 4 GB of free disk space and a free port (3000 by default).

## Install

1. Download the script of the newest release and run it:

   ```sh
   curl -fsSLO https://github.com/lunedo/lunedo/releases/latest/download/install.sh && bash install.sh
   ```

2. Answer the questions. Each has a default in brackets:
   - the installation directory, `/opt/lunedo`;
   - the address people open, for example `https://wiki.example.com`;
   - the fixed address of a reverse proxy in this Compose project, for example `172.30.0.10`, or empty for none.
3. Copy the setup link the script prints. It shows the link before it downloads the images, so you can copy it while the download runs.
4. Wait until the script reports that Lunedo runs, then open the link and follow the [setup assistant](../setup-assistant.md).
5. Put a [reverse proxy with TLS](../reverse-proxy.md) in front of Lunedo.
6. Copy `.env` from the installation directory to a safe place outside the server. It holds the master key and the backup key; a backup cannot be restored without them.

The script works through these steps:

1. It asks for the installation directory and stops if Lunedo is already installed there.
2. It checks Docker, Compose, the free disk space and the port, and lists everything that is missing before it stops.
3. It asks the other questions and checks the answers.
4. It writes `compose.yml` and `.env` and generates the secrets: the database password, the master key, the backup key, the metrics token and the setup code.
5. It prints the setup link with the code.
6. It downloads the images and starts Lunedo, waiting up to `LUNEDO_READY_TIMEOUT` seconds (600 by default) for `/health/ready`. When no version was given, it records the release the `latest` image belongs to in `compose.yml`, so that a restart never updates by accident.
7. It writes `.lunedo-install` and prints the next steps: the setup link, the reverse proxy and keeping the keys safe.

If Lunedo does not become ready in time, the script prints the last log lines. Fix the cause and start it with `cd /opt/lunedo && docker compose up -d`.

In that case the script has not written `.lunedo-install`. Until it exists, `./lunedo update` refuses the directory as not installed with the setup script, `./lunedo version` prints nothing, and running the script again does not write it either. Once Lunedo runs, read the version of its image and write the file with the installation method and that version; the next update completes it:

```sh
cd /opt/lunedo
docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$(sed -n 's/^    image: \(.*lunedo.*\)$/\1/p' compose.yml | head -n 1)"
printf 'method=script\nversion=%s\n' '<version>' > .lunedo-install
```

The script prints no secret except the setup code. Running it again in an existing installation directory changes nothing: it says that Lunedo is installed there and, in a terminal, offers to update it instead.

## Unattended installation

Pass every answer as an option:

```sh
bash install.sh --dir /opt/lunedo --url https://wiki.example.com --version 1.4.2 --yes
```

| Option | Meaning |
|---|---|
| `--dir <directory>` | Installation directory. |
| `--url <address>` | Address people open, with `https://` or `http://` and without a path. Without it, `--yes` uses `http://localhost:<port>`. An address other than `localhost` or `127.0.0.1` without `https://` gets a warning, because signing in needs HTTPS. |
| `--version <version>` | Version to install, such as `1.4.2`; the newest release by default. |
| `--image <reference>` | Another image, for example from a mirror registry. |
| `--port <port>` | Host port of Lunedo, `3000` by default. |
| `--bind <address>` | Host address the port listens on, `127.0.0.1` by default, for a reverse proxy on the same host. |
| `--subnet <cidr>` | Subnet of the Compose network, `172.30.0.0/24` by default. |
| `--proxy <address>` | Fixed IPv4 address of a reverse proxy that runs in the Compose project, for example `172.30.0.10`. It becomes the only entry of `LUNEDO_TRUSTED_PROXIES`. The script refuses the gateway of the Compose network, from which every program on the host connects. Without it, no proxy is trusted; see [Forwarded headers](../reverse-proxy.md#forwarded-headers-and-lunedo_trusted_proxies). |
| `--no-pull` | Use an image that is already on the host. |
| `--yes` | Accept every default without asking. |
| `--help` | Show the usage. |

## Files in the installation directory

The script creates the installation directory with mode 700, so only its owner (and root, through Docker) can reach the configuration, the secrets and the backups in it; `750` with the group `docker` works as well. It never changes the mode of a directory that already exists: it refuses one that other accounts can write to and warns about one they can read. The container runs as UID 1000, which on many hosts is also the first login account, for example `ubuntu` or `pi`: that account owns `backups/` on the host, so no other host account may be able to open the installation directory.

| File | Content |
|---|---|
| `compose.yml` | The [Compose file](compose.md), with the exact Lunedo version, readable by its owner only (mode 600), also after updates. |
| `.env` | The configuration and the secrets, readable by its owner only (mode 600): `POSTGRES_PASSWORD`, `LUNEDO_INSTANCE_URL`, `LUNEDO_SETUP_CODE`, `LUNEDO_MASTER_KEYS`, `LUNEDO_BACKUP_KEY`, `LUNEDO_METRICS_TOKEN`, `LUNEDO_TRUSTED_PROXIES`, `LUNEDO_SUBNET`, `LUNEDO_PORT`, `LUNEDO_BIND`, `LUNEDO_INSTALL_METHOD` and `LUNEDO_INSTALL_DIR`. Copy it to a safe place. |
| `backups/` | Backups, among them the ones taken before every update. It belongs to the user of the container (UID 1000) with mode 750; copy backups off the host as root. Temporary files of backups and test restores are not here but in the data volume (`LUNEDO_WORK_DIR`). |
| `lunedo` | The command for updates, maintenance mode and backups, described below. |
| `.lunedo-install` | The installation method, the installed and the previous version, the image and the dates of installation and update, read by the update command. |

The setup code from the script has 16 characters in groups of four, from an alphabet of 30 letters and digits. It works once.

## The lunedo command

The script copies itself into the installation directory as `lunedo`. Run it there, for example `cd /opt/lunedo && ./lunedo version`, or pass `--dir`. `./lunedo update` updates to the newest release or to the given one, with a backup first; see [Updates](../updates.md#with-the-update-command). `./lunedo print-compose` prints the Compose file the script writes, with `<version>` in place of the version, or the version given with `--version`. [Command line](../cli.md#lunedo-of-the-setup-script) lists every command and option.

`maintenance` and `backup` run `lunedo` inside the running `lunedo` container, so Lunedo must be running. Restoring a backup needs a stopped container instead; see [Rollback](../updates.md#rollback) and [Restore](../backups/restore.md).

### Commands in the container

The image contains the command `lunedo`. Without the setup script, run it with `docker compose exec lunedo lunedo <command>` in the running container, or with `docker compose run --rm lunedo <command>` while the container is stopped. [Command line](../cli.md#lunedo-in-the-image) lists its commands, their options and the exit codes, and [Backup reference](../backups/backup-reference.md) describes the backups they write.
