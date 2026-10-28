# Command line

This page is generated from `apps/worker/src/cli/commands.ts`, `scripts/install.sh` by `pnpm docs:generate`. Do not edit it by hand; change the code and run the command again.

Lunedo has two commands. `lunedo` is part of the image and works with the database, the file store and the backups of the instance. `./lunedo` is the setup script, copied into the installation directory; it installs and updates the installation and runs some commands of `lunedo` in the running container.

## lunedo in the image

Run it in the container with the same configuration as the instance, for example `docker compose exec lunedo lunedo <command>` while Lunedo runs, or `docker compose run --rm lunedo <command>` while it is stopped.

### `lunedo backup create --output <file>`

Writes a backup with everything to a file and prints the file and the number of entries. The directory must be writable by the container user; `/var/lib/lunedo/backups` is. When another backup is running, the command waits for it.

| Option | Description |
|---|---|
| `--output <file>` | The file to write the backup to. |

### `lunedo backup create --before-update`

Writes a backup of the class "before update" to the backup target, or to `LUNEDO_BACKUP_DIR` while no target is set up, and prints only its location: a path, or `s3://<bucket>/<key>`.

| Option | Description |
|---|---|
| `--before-update` | Writes to the backup target instead of a file. |

### `lunedo backup skip-before-update [--for-version <version>]`

Lets the next start of that version apply pending migrations without the backup before the update, once. Any other start removes this request.

| Option | Description |
|---|---|
| `--for-version <version>` | The version whose next start skips the backup, like 1.4.2. Without it, the configured version. |

### `lunedo backup verify --input <file>`

Checks the header, decrypts the whole backup and checks the manifest and every checksum without restoring anything. Needs the backup key only.

| Option | Description |
|---|---|
| `--input <file>` | The backup file to check. |

### `lunedo backup restore --input <file> [--force] [--config-dir <dir>]`

Restores a backup into an empty instance after verifying it. Start Lunedo afterwards to apply pending migrations.

| Option | Description |
|---|---|
| `--input <file>` | The backup file to restore. |
| `--force` | Replaces all database schemas and the content of the file store. |
| `--config-dir <dir>` | Writes the configuration files from the backup to this directory for review. They are never applied. |

### `lunedo keys rotate`

Starts a rotation to the newest master key. The worker re-wraps all data keys.

### `lunedo keys status`

Shows the current master key version, the available versions and the latest key rotation.

### `lunedo audit verify`

Checks the hash chain of the audit log of the instance and of every organization and prints one line per scope.

### `lunedo search rebuild`

Queues every page, blog post and running topic for a new search index. Search keeps answering meanwhile.

### `lunedo search status`

Shows the progress of a rebuild and how many pages wait for an update.

### `lunedo maintenance on [--message <text>] [--block-sign-in]`

Switches maintenance mode on: changes are refused for everyone, reading and search keep working.

| Option | Description |
|---|---|
| `--message <text>` | The message shown in the banner on every page. |
| `--block-sign-in` | Lets only instance administrators sign in while it is on. |

### `lunedo maintenance off`

Switches maintenance mode off.

### `lunedo maintenance status`

Shows whether maintenance mode is on, since when, whether signing in is paused and the message.

### `lunedo version`

Prints the version of the image.

### `lunedo release-notes [--since <version>] [--update-from <version>] [--json]`

Prints the changes of the releases in the image.

| Option | Description |
|---|---|
| `--since <version>` | Prints only the releases after this version. |
| `--update-from <version>` | Fails when the installed version cannot update to this one directly, and otherwise prints the releases after it. |
| `--json` | Prints the version file of the releases as JSON instead. |

### `lunedo help`

Shows this usage.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | The command failed; the message on standard error says why. audit verify also ends with 1 when an entry was changed, removed or inserted. |
| `64` | Unknown command or option; the usage follows. |
| `65` | release-notes `--update-from`: the update cannot be made in one step. |
| `78` | The configuration is not valid; the message names the setting. |

## ./lunedo of the setup script

Run it in the installation directory, for example `cd /opt/lunedo && ./lunedo version`, or pass `--dir`.

### Usage

| Command | Description |
|---|---|
| `install.sh [install] [options]` | Install Lunedo with Docker Compose. |
| `lunedo update [version] [options]` | Update this installation, with a backup first. |
| `lunedo maintenance on\|off\|status` | Switch maintenance mode, see lunedo maintenance `--help`. |
| `lunedo backup ...` | Run a backup command in the container. |
| `lunedo version` | Show the installed version. |
| `lunedo print-compose [options]` | Print the Compose file this script writes. |
| `lunedo help` | Show this help. |

### Options

| Option | Description |
|---|---|
| `--dir <directory>` | Installation directory (default `/opt/lunedo`). |
| `--url <address>` | Address people open, for example `https://wiki.example.org`. |
| `--version <version>` | Version to install or update to (default: the newest release). |
| `--image <reference>` | Image to use instead of `ghcr.io/lunedo/lunedo:<version>`. |
| `--port <port>` | Host port of Lunedo (default 3000). |
| `--bind <address>` | Host address the port listens on (default 127.0.0.1). |
| `--subnet <cidr>` | Subnet of the Compose network (default 172.30.0.0/24). |
| `--proxy <address>` | Fixed address of a reverse proxy on the Compose network, the only address Lunedo trusts for forwarded headers (default: none). |
| `--no-pull` | Use a local image without pulling it. |
| `--yes` | Answer every question with its default, for unattended runs. |
| `--help` | Show this help. |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | The command failed; the message says why. |

maintenance and backup end with the exit code of the command in the container.
