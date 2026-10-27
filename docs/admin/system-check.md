# System check

The system check is the second step of the [setup assistant](setup-assistant.md). It comes after the instance step, so it can check the address. Each check shows one of these states:

| State | Meaning |
|---|---|
| **OK** | The check passed. |
| **Info** | A note that needs no action, such as a local address that cannot be checked from outside. |
| **Warning** | Something to fix before people use the instance. Warnings do not block the setup. |
| **Must be fixed** | An error. The setup cannot continue until it is fixed. |

A check that did not pass names its cause, shows a command when one fixes it, and links the section below. The database, clock and file storage checks run again every time the step is shown and with **Check again**. The address check runs again until the step is confirmed; after that its result is kept.

After the setup, the [system status](system-status.md) page watches a running instance.

## Database

| Cause | State | What to do |
|---|---|---|
| `unreachable` | Must be fixed | Lunedo cannot reach the database. Check `LUNEDO_DATABASE_URL` and that PostgreSQL runs, then check again. |
| `migrationsPending` | Must be fixed | The database schema is older than this version of Lunedo. Restart the Lunedo container so that it applies the migrations, and look for migration errors in its log. |

When the check passes, it shows the version of PostgreSQL. See [Requirements](requirements.md#database).

## Clock

| Cause | State | What to do |
|---|---|---|
| `offset` | Warning | The clocks of Lunedo and the database differ by more than 5 seconds. Time-based codes and session expiry depend on matching clocks. Synchronize both hosts, for example with NTP, then check again. |
| `unknown` | Warning | The database did not answer, so the difference could not be measured. Fix the database connection first. |

## File storage

The check writes and removes a file in `LUNEDO_FILES_DIR` (`/var/lib/lunedo/files` by default) and reports the path, the user Lunedo runs as and the owner of the directory.

| Cause | State | What to do |
|---|---|---|
| `missing` | Must be fixed | The directory does not exist. Create it and give it to the user Lunedo runs as, for example `mkdir -p /var/lib/lunedo/files && chown 1000:1000 /var/lib/lunedo/files`. |
| `notWritable` | Must be fixed | The user Lunedo runs as cannot write to it, usually because a mounted volume belongs to another user. Change the owner, for example `chown -R 1000:1000 /var/lib/lunedo/files`: on the host for a bind mount, or with `docker compose exec -u root lunedo` for a volume. |
| `lowSpace` | Warning | Less than 1 GiB is free. Free up space or give the volume more space before people upload files. |

The check shows the exact command with the path and the user of your installation.

## Instance URL

| Cause | State | What to do |
|---|---|---|
| `notSet` | Warning | Neither the instance step nor `LUNEDO_INSTANCE_URL` has set the address of the instance yet. Enter it in the **Instance** step. |

When `LUNEDO_INSTANCE_URL` is set, the check shows it as configured until the instance step stores an address. See [Instance address](instance-address.md).

## Address reachable

Lunedo stores a random challenge and its answer in the database, requests `<instance address>/api/v1/setup/probe/<challenge>` and compares the answer, so only a node of this instance can pass. The request follows up to three redirects on the same host, never connects to link-local addresses such as cloud metadata services, and gives up after 4 seconds.

| Cause | State | What to do |
|---|---|---|
| `loopback` | Info | The address is local (`localhost`, a name ending in `.localhost`, `127.0.0.0/8` or `::1`). It is not requested, because it cannot be checked from outside. |
| `notSet` | Warning | No instance address is known. Enter it in the **Instance** step. |
| `unreachable` | Warning | Nothing answered, for example because the name does not resolve, a firewall blocks the connection or the certificate is not valid. Check DNS, the reverse proxy and the certificate. |
| `otherServer` | Warning | Another server answered, or a redirect led to another host. Check that the reverse proxy forwards the address to this Lunedo container and that the address in the **Instance** step is right. |

The check is a warning only, because some networks do not let a server reach itself through its public address while people outside can. In that case, open the address in a browser to check it.

## HTTPS

Lunedo does not speak TLS itself; a reverse proxy in front of it does. See [Reverse proxy](reverse-proxy.md#tls-and-the-instance-address) and the examples for [Caddy](reverse-proxy/caddy.md), [nginx](reverse-proxy/nginx.md) and [Traefik](reverse-proxy/traefik.md).

| Cause | State | What to do |
|---|---|---|
| `instanceUrlNotHttps` | Warning | The instance address, stored or from `LUNEDO_INSTANCE_URL`, does not start with `https://`. Set up a reverse proxy with TLS and use an `https://` address. |
| `requestNotHttps` | Warning | No instance address is known and this page was not loaded over HTTPS. Either the request reached Lunedo without TLS, or the reverse proxy is not listed in `LUNEDO_TRUSTED_PROXIES`, so its `X-Forwarded-Proto` header is ignored. |

Once an instance address is known, only that address is checked, not the address the setup is opened with. Set up TLS before you invite people.
